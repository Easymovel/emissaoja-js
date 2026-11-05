// emissaoja: cliente oficial da API de NFS-e do emissaoja (https://emissaoja.com.br/docs/).
// Emite Nota Fiscal de Serviço eletrônica no Emissor Nacional (nfse.gov.br) com CNPJ e senha do portal, sem
// certificado digital, para MEI e empresas do Simples Nacional.
//
// ESM, sem dependências, só `fetch` (Node 18+, Deno, Bun, Cloudflare Workers). Mesma forma em todas as linguagens:
// `new Emissaoja({ chave })`, recursos `empresa`, `tomadores`, `servicos`, `notas`, `emissoes`, `operacoes`, `cnpj`.
// Erros da API viram `EmissaojaErro` com `code` (a lista fechada da API).

export const BASE_PRODUCAO = 'https://emissaoja.com.br';
export const BASE_SANDBOX = 'https://sandbox.emissaoja.com.br';
export const VERSAO = '0.1.0';
const BASE_PADRAO = BASE_PRODUCAO;
const RE_REFERENCIA = /^[A-Za-z0-9_-]{8,64}$/;
const TERMINAIS = new Set(['autorizada', 'recusada', 'incerta']);

export class EmissaojaErro extends Error {
  constructor(status, corpo, { requestId } = {}) {
    const c = corpo && typeof corpo === 'object' ? corpo : {};
    super(c.message || `HTTP ${status}`);
    this.name = 'EmissaojaErro';
    this.status = status;
    /** Código da lista fechada da API (decida por ele, nunca pelo texto). */
    this.code = c.code || 'erro_desconhecido';
    const { status: _s, message: _m, code: _c, ...extras } = c;
    /** Campos extras do erro: `bloqueios`, `nota_igual_recente`, `pedido_id`, `details`, `retry_after`… */
    this.extras = extras;
    this.requestId = requestId || null;
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class Emissaoja {
  /**
   * @param {{ chave?: string, baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} [opcoes]
   *   `chave` lê `EMISSAOJA_KEY` quando omitida (na primeira chamada, não no construtor).
   */
  constructor(opcoes = {}) {
    this._chave = opcoes.chave ?? null;
    this.baseUrl = String(opcoes.baseUrl || BASE_PADRAO).replace(/\/+$/, '');
    this._fetch = opcoes.fetch || globalThis.fetch;
    this.timeoutMs = opcoes.timeoutMs ?? 30_000;
    /** Espera entre consultas dos métodos `aguardar*` (injetável nos testes). */
    this._dormir = opcoes.dormir || dormir;
    if (typeof this._fetch !== 'function') throw new Error('emissaoja: fetch indisponível; passe { fetch } nas opções');

    this.empresa = {
      /** `GET /v1/empresa` */
      obter: () => this._json('GET', '/v1/empresa'),
      /** `PUT /v1/empresa/credencial`: CNPJ e senha do Emissor Nacional → `{ tentativa }` (202). */
      conectar: ({ cnpj, senha, cienteUltimaTentativa = false }) => this._json('PUT', '/v1/empresa/credencial', { cnpj, senha, ciente_ultima_tentativa: cienteUltimaTentativa }),
      /** `GET /v1/empresa/credencial` */
      credencial: () => this._json('GET', '/v1/empresa/credencial'),
      /** Consulta a credencial até `tentativa.proximo_passo` sair de `aguardar`. → a resposta de `credencial()` */
      aguardarCredencial: async ({ intervaloMs = 2000, timeoutMs = 120_000 } = {}) => {
        const fim = Date.now() + timeoutMs;
        for (;;) {
          const r = await this.empresa.credencial();
          if (!r.tentativa || r.tentativa.proximo_passo !== 'aguardar') return r;
          if (Date.now() > fim) throw new EmissaojaErro(0, { code: 'tempo_esgotado', message: 'A verificação da senha não terminou a tempo.' });
          await this._dormir(intervaloMs);
        }
      },
      /** `GET /v1/empresa/onboarding` */
      onboarding: () => this._json('GET', '/v1/empresa/onboarding'),
      /** `PUT /v1/empresa/fiscal` `{ aliquota_simples?, reg_ap_trib_sn? }` */
      fiscal: (corpo) => this._json('PUT', '/v1/empresa/fiscal', corpo),
      /** `POST /v1/empresa/reler-fisco` */
      relerFisco: () => this._json('POST', '/v1/empresa/reler-fisco'),
    };

    this.tomadores = {
      /** `GET /v1/tomadores?busca&pagina&limite&ordem` */
      listar: (params = {}) => this._json('GET', '/v1/tomadores', undefined, params),
      /** `GET /v1/tomadores/busca?q=` */
      buscar: (q) => this._json('GET', '/v1/tomadores/busca', undefined, { q }),
      /** `POST /v1/tomadores` `{ documento, nome? }` → `{ tomador, ja_existia }` */
      criar: (corpo) => this._json('POST', '/v1/tomadores', corpo),
      /** `GET /v1/tomadores/{tipo}/{id}` */
      obter: (tipo, id) => this._json('GET', `/v1/tomadores/${enc(tipo)}/${enc(id)}`),
      /** `PUT /v1/tomadores/{tipo}/{id}` (edição parcial) */
      atualizar: (tipo, id, corpo) => this._json('PUT', `/v1/tomadores/${enc(tipo)}/${enc(id)}`, corpo),
    };

    this.servicos = {
      /** `GET /v1/servicos?ativos=1|0|todos` */
      listar: (params = {}) => this._json('GET', '/v1/servicos', undefined, params),
      /** `POST /v1/servicos` */
      criar: (corpo) => this._json('POST', '/v1/servicos', corpo),
      /** `PUT /v1/servicos/{id}` (edição parcial) */
      atualizar: (id, corpo) => this._json('PUT', `/v1/servicos/${enc(id)}`, corpo),
      /** `DELETE /v1/servicos/{id}` (desativa) */
      desativar: (id) => this._json('DELETE', `/v1/servicos/${enc(id)}`),
      /** `GET /v1/catalogo/servicos?q=&limite=` */
      catalogo: (q, limite) => this._json('GET', '/v1/catalogo/servicos', undefined, { q, ...(limite ? { limite } : {}) }),
    };

    this.notas = {
      /**
       * `POST /v1/notas` com `Idempotency-Key` = `referencia` (obrigatória: um id seu por nota). → `{ pedido, previa }`
       * (202) ou `{ pedido, repetido: true }` (200, mesma referência).
       */
      emitir: async ({ referencia, ...campos } = {}) => {
        if (typeof referencia !== 'string' || !RE_REFERENCIA.test(referencia)) {
          throw new EmissaojaErro(0, { code: 'chave_idempotencia_invalida', message: 'Informe `referencia` (8 a 64 caracteres: letras, números, _ e -), única por nota.' });
        }
        const corpo = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined && v !== null));
        return this._json('POST', '/v1/notas', corpo, undefined, { 'Idempotency-Key': referencia });
      },
      /** Consulta o pedido até `autorizada`, `recusada` ou `incerta`, respeitando `proxima_consulta_ms`. → `{ pedido }` */
      aguardar: async (pedidoId, { timeoutMs = 180_000, intervaloMinimoMs = 1000 } = {}) => {
        const fim = Date.now() + timeoutMs;
        for (;;) {
          const r = await this.emissoes.obter(pedidoId);
          if (TERMINAIS.has(r.pedido?.estado)) return r;
          if (Date.now() > fim) throw new EmissaojaErro(0, { code: 'tempo_esgotado', message: 'O pedido não terminou a tempo; consulte de novo mais tarde.', pedido_id: pedidoId });
          await this._dormir(Math.max(intervaloMinimoMs, Number(r.pedido?.proxima_consulta_ms) || 3000));
        }
      },
      /** `GET /v1/notas?periodo&de&ate&situacao&busca&cursor&limite` */
      listar: (params = {}) => this._json('GET', '/v1/notas', undefined, params),
      /** `GET /v1/notas/{origem}/{id}/pdf` → `Uint8Array` */
      pdf: (origem, id) => this._bytes(`/v1/notas/${enc(origem)}/${enc(id)}/pdf`),
      /** `GET /v1/notas/{origem}/{id}/xml` → `string` */
      xml: async (origem, id) => new TextDecoder().decode(await this._bytes(`/v1/notas/${enc(origem)}/${enc(id)}/xml`)),
      /** `POST /v1/notas/{origem}/{id}/cancelar` `{ motivo: "1"|"2", justificativa? }` → `{ operacao }` (202) */
      cancelar: (origem, id, corpo) => this._json('POST', `/v1/notas/${enc(origem)}/${enc(id)}/cancelar`, corpo),
    };

    this.emissoes = {
      /** `GET /v1/emissoes/{id}` → `{ pedido }` */
      obter: (id) => this._json('GET', `/v1/emissoes/${enc(id)}`),
      /** `GET /v1/emissoes?estados=` → `{ pedidos }` */
      listar: (params = {}) => this._json('GET', '/v1/emissoes', undefined, params),
      /** `POST /v1/emissoes/{id}/conferir` */
      conferir: (id) => this._json('POST', `/v1/emissoes/${enc(id)}/conferir`),
    };

    this.operacoes = {
      /** `GET /v1/operacoes/{id}` → `{ operacao }` */
      obter: (id) => this._json('GET', `/v1/operacoes/${enc(id)}`),
      /** Consulta até `concluida` ou `falhou`. */
      aguardar: async (id, { intervaloMs = 2000, timeoutMs = 180_000 } = {}) => {
        const fim = Date.now() + timeoutMs;
        for (;;) {
          const r = await this.operacoes.obter(id);
          if (r.operacao?.estado !== 'processando') return r;
          if (Date.now() > fim) throw new EmissaojaErro(0, { code: 'tempo_esgotado', message: 'A operação não terminou a tempo.' });
          await this._dormir(intervaloMs);
        }
      },
    };

    this.cnpj = {
      /** `GET /v1/cnpj/{cnpj}` (dados da Receita, via apipj) */
      consultar: (cnpj) => this._json('GET', `/v1/cnpj/${enc(String(cnpj).replace(/\D/g, ''))}`),
    };
  }

  /** `GET /v1/status` (sem chave) */
  status() { return this._json('GET', '/v1/status', undefined, undefined, {}, { semChave: true }); }

  get chave() {
    if (this._chave === null) {
      const env = globalThis.process?.env?.EMISSAOJA_KEY;
      if (!env) throw new EmissaojaErro(0, { code: 'chave_invalida', message: 'Informe a chave: new Emissaoja({ chave }) ou a variável EMISSAOJA_KEY.' });
      this._chave = env;
    }
    return this._chave;
  }

  async _req(metodo, caminho, corpo, query, cabecalhos = {}, { semChave = false } = {}) {
    const url = new URL(this.baseUrl + caminho);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers = { accept: 'application/json', 'user-agent': `emissaoja-js/${VERSAO}`, ...cabecalhos };
    if (!semChave) headers.authorization = `Bearer ${this.chave}`;
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    try {
      return await this._fetch(url.toString(), { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: ctrl?.signal });
    } catch (e) {
      throw new EmissaojaErro(0, { code: e?.name === 'AbortError' ? 'tempo_esgotado' : 'rede', message: e?.message || 'Falha de rede' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async _json(metodo, caminho, corpo, query, cabecalhos, opcoes) {
    const res = await this._req(metodo, caminho, corpo, query, cabecalhos, opcoes);
    const requestId = res.headers.get('x-request-id');
    let json = null;
    const texto = await res.text();
    if (texto) { try { json = JSON.parse(texto); } catch { json = null; } }
    if (!res.ok) throw new EmissaojaErro(res.status, json || { message: texto.slice(0, 200) || `HTTP ${res.status}` }, { requestId });
    return json ?? {};
  }

  async _bytes(caminho) {
    const res = await this._req('GET', caminho);
    if (!res.ok) {
      let json = null;
      try { json = await res.json(); } catch { /* corpo não é JSON */ }
      throw new EmissaojaErro(res.status, json || { message: `HTTP ${res.status}` }, { requestId: res.headers.get('x-request-id') });
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}

const enc = (v) => encodeURIComponent(String(v));

export default Emissaoja;
