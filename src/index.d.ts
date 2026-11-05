/** `https://emissaoja.com.br` */
export declare const BASE_PRODUCAO: string;
/** `https://sandbox.emissaoja.com.br` (Emissor Nacional simulado; chaves `ej_test_`). */
export declare const BASE_SANDBOX: string;
export declare const VERSAO: string;

export interface OpcoesEmissaoja {
  /** Chave `ej_live_…` (produção) ou `ej_test_…` (sandbox), criada em Conta → API. Omitida: `EMISSAOJA_KEY`. */
  chave?: string;
  /** Padrão `https://emissaoja.com.br` (`BASE_PRODUCAO`). Sandbox: `BASE_SANDBOX`. */
  baseUrl?: string;
  /** `fetch` alternativo (padrão: o global). */
  fetch?: typeof fetch;
  /** Tempo máximo de cada chamada, em ms (padrão 30000). */
  timeoutMs?: number;
  /** Espera entre consultas dos métodos `aguardar*` (padrão: `setTimeout`). Útil em testes. */
  dormir?: (ms: number) => Promise<void>;
}

export declare class EmissaojaErro extends Error {
  status: number;
  /** Código da lista fechada da API (ex.: `chave_invalida`, `nota_bloqueada`, `limite_notas`, `rate_limited`). */
  code: string;
  extras: Record<string, unknown> & { bloqueios?: Bloqueio[]; nota_igual_recente?: NotaIgualRecente; pedido_id?: string; retry_after?: number };
  requestId: string | null;
}

export type TipoTomador = "pj" | "pf";
export type OrigemNota = "local" | "importada";
export type EstadoPedido = "na_fila" | "emitindo" | "confirmando" | "autorizada" | "recusada" | "incerta";

export interface Bloqueio { code: string; mensagem: string; acao: string }
export interface NotaIgualRecente { pedido_id: string; numero_nfse: string | null; emitida_em: string | null; status: string }

export interface Tomador { tipo: TipoTomador; id: string; nome: string; documento: string; documento_formatado: string; cidade: string | null; uf: string | null; notas_emitidas?: number; ultima_nota_em?: string | null }
export interface Servico { id: string; descricao: string; descricao_da_nota: string | null; principal: boolean; ativo: boolean; c_trib_nac: string | null; c_trib_mun: string | null; item_lc116: string | null; nbs: string | null; trib_issqn: "tributavel" | "nao_incidencia"; tp_oper: number | null; retem_iss: boolean; aliquota_iss: number | null }
export interface Pedido { id: string; estado: EstadoPedido; motivo_code: string | null; motivo: string | null; numero: string | null; chave_acesso: string | null; consulta_publica_url: string | null; nota: { origem: OrigemNota; id: string } | null; acoes: string[]; proxima_consulta_ms: number | null; [k: string]: unknown }
export interface Nota { origem: OrigemNota; id: string; numero: string | null; situacao: string; emitida_em: string | null; competencia: string | null; tomador: Record<string, unknown>; descricao: string | null; valor: number; chave_acesso: string | null; pedido_id: string | null }
export interface Operacao { id: string; tipo: string; estado: "processando" | "concluida" | "falhou"; resultado: Record<string, unknown> | null; erro: { code: string; message: string; motivo_fisco: { codigos: string[]; texto: string | null } | null } | null }
export interface Tentativa { id: string; estado: string; proximo_passo: "aguardar" | "configurando" | "pronto" | "corrigir_senha" | "tentar_mais_tarde" | "redefinir_no_portal" | "suporte"; code: string | null; [k: string]: unknown }
export interface Credencial { estado: "ausente" | "verificando" | "ativa" | "congelada"; congelada_em: string | null; tentativa_em_voo: string | null }
export interface Empresa { usuario: { email: string }; empresa: { cnpj: string; cnpj_formatado: string; nome: string | null; porte_simples: "mei" | "me_epp" | null; vinculo: string } | null; credencial: Credencial; onboarding: { estado: string }; importacao: { continuando: boolean; notas_importadas: number | null } | null; avisos: Array<{ code: string }>; aceite: { pendente: boolean }; tempo: string }

export interface CamposNota {
  tomador_tipo: TipoTomador;
  tomador_id: string;
  valor: number;
  servico_id?: string;
  descricao?: string;
  competencia?: string;
  retem_iss?: boolean;
  aliquota_iss?: number;
  municipio_prestacao?: string;
  confirmo_repeticao?: boolean;
  permitir_repetida_de?: string;
}

export declare class Emissaoja {
  constructor(opcoes?: OpcoesEmissaoja);
  baseUrl: string;
  readonly chave: string;
  status(): Promise<{ ok: boolean; versao: string; motor: "ok" | "degradado" | "simulado"; tempo: string }>;
  empresa: {
    obter(): Promise<Empresa>;
    conectar(p: { cnpj: string; senha: string; cienteUltimaTentativa?: boolean }): Promise<{ tentativa: Tentativa }>;
    credencial(): Promise<{ credencial: Credencial; onboarding: { estado: string }; tentativa: Tentativa | null }>;
    aguardarCredencial(o?: { intervaloMs?: number; timeoutMs?: number }): Promise<{ credencial: Credencial; onboarding: { estado: string }; tentativa: Tentativa | null }>;
    onboarding(): Promise<Record<string, unknown>>;
    fiscal(corpo: { aliquota_simples?: number; reg_ap_trib_sn?: 1 | 2 | 3 }): Promise<Record<string, unknown>>;
    relerFisco(): Promise<Record<string, unknown>>;
  };
  tomadores: {
    listar(params?: { busca?: string; pagina?: number; limite?: number; ordem?: "nome" | "recentes" }): Promise<{ tomadores: Tomador[]; total: number; pagina: number; limite: number }>;
    buscar(q: string): Promise<{ tomadores: Tomador[] }>;
    criar(corpo: { documento: string; nome?: string }): Promise<{ tomador: Tomador; ja_existia: boolean }>;
    obter(tipo: TipoTomador, id: string): Promise<{ tomador: Record<string, unknown> }>;
    atualizar(tipo: TipoTomador, id: string, corpo: Record<string, unknown>): Promise<{ tomador: Record<string, unknown> }>;
  };
  servicos: {
    listar(params?: { ativos?: "1" | "0" | "todos" }): Promise<{ servicos: Servico[] }>;
    criar(corpo: Partial<Servico> & { descricao: string; c_trib_nac: string; trib_issqn: "tributavel" | "nao_incidencia"; retem_iss: boolean }): Promise<{ servico: Servico }>;
    atualizar(id: string, corpo: Partial<Servico>): Promise<{ servico: Servico; vinculos_atualizados: number }>;
    desativar(id: string): Promise<{ servico: Servico }>;
    catalogo(q: string, limite?: number): Promise<{ itens: Array<{ c_trib_nac: string; descricao: string; item_lc116: string; nbs_sugeridos: Array<{ nbs: string | null; descricao: string | null }> }> }>;
  };
  notas: {
    emitir(p: CamposNota & { referencia: string }): Promise<{ pedido: Pedido; previa?: { resumo: Record<string, unknown>; avisos: Bloqueio[] }; repetido?: boolean }>;
    aguardar(pedidoId: string, o?: { timeoutMs?: number; intervaloMinimoMs?: number }): Promise<{ pedido: Pedido }>;
    listar(params?: { periodo?: "mes_atual" | "mes_anterior" | "ano_atual" | "12_meses" | "personalizado"; de?: string; ate?: string; situacao?: "todas" | "emitidas" | "canceladas"; busca?: string; cursor?: string; limite?: number }): Promise<{ notas: Nota[]; total: number; janela_cheia: boolean; proximo_cursor: string | null }>;
    pdf(origem: OrigemNota, id: string): Promise<Uint8Array>;
    xml(origem: OrigemNota, id: string): Promise<string>;
    cancelar(origem: OrigemNota, id: string, corpo: { motivo: "1" | "2"; justificativa?: string }): Promise<{ operacao: Operacao }>;
  };
  emissoes: {
    obter(id: string): Promise<{ pedido: Pedido }>;
    listar(params?: { estados?: string }): Promise<{ pedidos: Pedido[] }>;
    conferir(id: string): Promise<{ pedido: Pedido }>;
  };
  operacoes: {
    obter(id: string): Promise<{ operacao: Operacao }>;
    aguardar(id: string, o?: { intervaloMs?: number; timeoutMs?: number }): Promise<{ operacao: Operacao }>;
  };
  cnpj: { consultar(cnpj: string): Promise<Record<string, unknown>> };
}

export default Emissaoja;
