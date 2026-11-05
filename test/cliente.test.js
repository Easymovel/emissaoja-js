// Testes sem rede: o `fetch` do cliente é trocado por um falso que guarda as chamadas e responde pelo caminho.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Emissaoja, EmissaojaErro, BASE_PRODUCAO, BASE_SANDBOX, VERSAO } from '../src/index.js';

const CHAVE = 'ej_test_' + 'a'.repeat(43);

function fetchFalso(rotas = {}) {
  const chamadas = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    chamadas.push({ url: u, metodo: init.method, headers: init.headers, corpo: init.body });
    const r = rotas[`${init.method} ${u.pathname}`];
    const resp = typeof r === 'function' ? r(u, init) : r;
    if (!resp) return new Response(JSON.stringify({ status: 'ERROR', code: 'not_found', message: 'Rota não encontrada.' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const [status, corpo, headers = {}] = resp;
    if (corpo instanceof Uint8Array || typeof corpo === 'string') return new Response(corpo, { status, headers });
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'r_teste', ...headers } });
  };
  fn.chamadas = chamadas;
  return fn;
}

const semEspera = async () => {};

describe('Emissaoja', () => {
  let envAntes;
  beforeEach(() => { envAntes = process.env.EMISSAOJA_KEY; delete process.env.EMISSAOJA_KEY; });
  afterEach(() => { if (envAntes === undefined) delete process.env.EMISSAOJA_KEY; else process.env.EMISSAOJA_KEY = envAntes; });

  test('constantes de ambiente e versão', () => {
    assert.equal(BASE_PRODUCAO, 'https://emissaoja.com.br');
    assert.equal(BASE_SANDBOX, 'https://sandbox.emissaoja.com.br');
    assert.match(VERSAO, /^\d+\.\d+\.\d+$/);
    assert.equal(new Emissaoja({ chave: CHAVE, fetch: fetchFalso() }).baseUrl, BASE_PRODUCAO);
    assert.equal(new Emissaoja({ chave: CHAVE, baseUrl: BASE_SANDBOX + '/', fetch: fetchFalso() }).baseUrl, BASE_SANDBOX);
  });

  test('status() vai sem Authorization; as outras rotas levam a chave e o User-Agent', async () => {
    const f = fetchFalso({ 'GET /v1/status': [200, { ok: true, motor: 'simulado' }], 'GET /v1/empresa': [200, { empresa: null }] });
    const ej = new Emissaoja({ chave: CHAVE, baseUrl: BASE_SANDBOX, fetch: f });
    assert.equal((await ej.status()).motor, 'simulado');
    assert.equal(f.chamadas[0].headers.authorization, undefined);
    await ej.empresa.obter();
    assert.equal(f.chamadas[1].headers.authorization, `Bearer ${CHAVE}`);
    assert.equal(f.chamadas[1].headers['user-agent'], `emissaoja-js/${VERSAO}`);
    assert.equal(f.chamadas[1].headers['content-type'], undefined, 'sem corpo, sem content-type');
  });

  test('chave lida de EMISSAOJA_KEY na primeira chamada; sem ela, chave_invalida sem ir à rede', async () => {
    const f = fetchFalso({ 'GET /v1/empresa': [200, { empresa: null }] });
    const ej = new Emissaoja({ fetch: f });
    await assert.rejects(ej.empresa.obter(), (e) => e instanceof EmissaojaErro && e.code === 'chave_invalida' && e.status === 0);
    assert.equal(f.chamadas.length, 0);
    process.env.EMISSAOJA_KEY = CHAVE;
    await ej.empresa.obter();
    assert.equal(f.chamadas[0].headers.authorization, `Bearer ${CHAVE}`);
  });

  test('emitir: referência inválida rejeita sem chamar a API; válida vira Idempotency-Key e nulos ficam fora do corpo', async () => {
    const f = fetchFalso({ 'POST /v1/notas': [202, { pedido: { id: 'p1', estado: 'na_fila' }, previa: { resumo: {}, avisos: [] } }] });
    const ej = new Emissaoja({ chave: CHAVE, fetch: f });
    await assert.rejects(ej.notas.emitir({ referencia: 'curta', tomador_tipo: 'pj', tomador_id: 'x', valor: 10 }), (e) => e.code === 'chave_idempotencia_invalida');
    await assert.rejects(ej.notas.emitir({ tomador_tipo: 'pj', tomador_id: 'x', valor: 10 }), (e) => e.code === 'chave_idempotencia_invalida');
    assert.equal(f.chamadas.length, 0);
    const r = await ej.notas.emitir({ referencia: 'pedido-0001', tomador_tipo: 'pj', tomador_id: 't1', valor: 1500, descricao: 'Consultoria', competencia: null, servico_id: undefined });
    assert.equal(r.pedido.id, 'p1');
    const c = f.chamadas[0];
    assert.equal(c.headers['Idempotency-Key'], 'pedido-0001');
    assert.equal(c.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(c.corpo), { tomador_tipo: 'pj', tomador_id: 't1', valor: 1500, descricao: 'Consultoria' });
  });

  test('erro da API vira EmissaojaErro com code, status, extras e requestId', async () => {
    const corpo = { status: 'ERROR', code: 'nota_bloqueada', message: 'Antes de emitir, resolva:', bloqueios: [{ code: 'tomador_incompleto', mensagem: 'Falta o endereço.', acao: 'completar_tomador' }] };
    const ej = new Emissaoja({ chave: CHAVE, fetch: fetchFalso({ 'POST /v1/notas': [422, corpo] }) });
    await assert.rejects(ej.notas.emitir({ referencia: 'pedido-0002', tomador_tipo: 'pj', tomador_id: 't1', valor: 10 }), (e) => {
      assert.ok(e instanceof EmissaojaErro && e instanceof Error);
      assert.equal(e.status, 422);
      assert.equal(e.code, 'nota_bloqueada');
      assert.equal(e.message, 'Antes de emitir, resolva:');
      assert.equal(e.requestId, 'r_teste');
      assert.equal(e.extras.bloqueios[0].acao, 'completar_tomador');
      assert.equal(e.extras.code, undefined);
      return true;
    });
  });

  test('corpo de erro que não é JSON vira mensagem curta e code erro_desconhecido', async () => {
    const ej = new Emissaoja({ chave: CHAVE, fetch: fetchFalso({ 'GET /v1/empresa': [502, '<html>Bad gateway</html>'] }) });
    await assert.rejects(ej.empresa.obter(), (e) => e.status === 502 && e.code === 'erro_desconhecido' && e.message.includes('Bad gateway'));
  });

  test('falha de rede vira code rede', async () => {
    const ej = new Emissaoja({ chave: CHAVE, fetch: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(ej.empresa.obter(), (e) => e.status === 0 && e.code === 'rede');
  });

  test('aguardar respeita proxima_consulta_ms e para no estado terminal', async () => {
    const estados = [{ estado: 'na_fila', proxima_consulta_ms: 1500 }, { estado: 'emitindo', proxima_consulta_ms: 10 }, { estado: 'autorizada', numero: '42', nota: { origem: 'local', id: 'n1' } }];
    const esperas = [];
    const ej = new Emissaoja({ chave: CHAVE, dormir: async (ms) => { esperas.push(ms); }, fetch: fetchFalso({ 'GET /v1/emissoes/p1': () => [200, { pedido: { id: 'p1', ...estados.shift() } }] }) });
    const r = await ej.notas.aguardar('p1');
    assert.equal(r.pedido.estado, 'autorizada');
    assert.equal(r.pedido.numero, '42');
    assert.deepEqual(esperas, [1500, 1000], 'nunca abaixo do intervalo mínimo de 1 s');
  });

  test('aguardar estoura tempo_esgotado com o pedido_id', async () => {
    const ej = new Emissaoja({ chave: CHAVE, dormir: semEspera, fetch: fetchFalso({ 'GET /v1/emissoes/p9': [200, { pedido: { id: 'p9', estado: 'emitindo', proxima_consulta_ms: 1 } }] }) });
    await assert.rejects(ej.notas.aguardar('p9', { timeoutMs: -1 }), (e) => e.code === 'tempo_esgotado' && e.extras.pedido_id === 'p9');
  });

  test('aguardarCredencial e operacoes.aguardar param quando saem de aguardar/processando', async () => {
    const tentativas = [{ proximo_passo: 'aguardar' }, { proximo_passo: 'pronto' }];
    const ops = [{ estado: 'processando' }, { estado: 'concluida' }];
    const ej = new Emissaoja({ chave: CHAVE, dormir: semEspera, fetch: fetchFalso({
      'GET /v1/empresa/credencial': () => [200, { credencial: { estado: 'verificando' }, tentativa: tentativas.shift() }],
      'GET /v1/operacoes/o1': () => [200, { operacao: { id: 'o1', ...ops.shift() } }],
    }) });
    assert.equal((await ej.empresa.aguardarCredencial()).tentativa.proximo_passo, 'pronto');
    assert.equal((await ej.operacoes.aguardar('o1')).operacao.estado, 'concluida');
  });

  test('PDF em bytes, XML em texto, query sem vazios e segmentos codificados', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 teste');
    const f = fetchFalso({
      'GET /v1/notas/local/a%2Fb/pdf': [200, pdf, { 'content-type': 'application/pdf' }],
      'GET /v1/notas/local/n1/xml': [200, '<?xml version="1.0"?><NFSe/>', { 'content-type': 'application/xml' }],
      'GET /v1/tomadores': [200, { tomadores: [], total: 0 }],
    });
    const ej = new Emissaoja({ chave: CHAVE, fetch: f });
    const bytes = await ej.notas.pdf('local', 'a/b');
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), '%PDF');
    assert.match(await ej.notas.xml('local', 'n1'), /<NFSe/);
    await ej.tomadores.listar({ busca: 'alfa', pagina: 2, limite: undefined, ordem: '' });
    assert.equal(f.chamadas.at(-1).url.search, '?busca=alfa&pagina=2');
  });

  test('cnpj.consultar tira a pontuação; conectar manda ciente_ultima_tentativa', async () => {
    const f = fetchFalso({ 'GET /v1/cnpj/12345678000195': [200, { razao_social: 'ALFA LTDA' }], 'PUT /v1/empresa/credencial': [202, { tentativa: { id: 't1', proximo_passo: 'aguardar' } }] });
    const ej = new Emissaoja({ chave: CHAVE, fetch: f });
    assert.equal((await ej.cnpj.consultar('12.345.678/0001-95')).razao_social, 'ALFA LTDA');
    await ej.empresa.conectar({ cnpj: '11111111000191', senha: 'segredo' });
    assert.deepEqual(JSON.parse(f.chamadas.at(-1).corpo), { cnpj: '11111111000191', senha: 'segredo', ciente_ultima_tentativa: false });
  });

  test('cancelar e conferir usam POST nas rotas certas', async () => {
    const f = fetchFalso({ 'POST /v1/notas/local/n1/cancelar': [202, { operacao: { id: 'o1', estado: 'processando' } }], 'POST /v1/emissoes/p1/conferir': [200, { pedido: { id: 'p1', estado: 'autorizada' } }] });
    const ej = new Emissaoja({ chave: CHAVE, fetch: f });
    assert.equal((await ej.notas.cancelar('local', 'n1', { motivo: '1', justificativa: 'Valor digitado errado.' })).operacao.id, 'o1');
    assert.deepEqual(JSON.parse(f.chamadas[0].corpo), { motivo: '1', justificativa: 'Valor digitado errado.' });
    assert.equal((await ej.emissoes.conferir('p1')).pedido.estado, 'autorizada');
  });
});
