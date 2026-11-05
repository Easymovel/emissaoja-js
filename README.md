# emissaoja: API de NFS-e nacional para Node.js e TypeScript

[![npm](https://img.shields.io/npm/v/emissaoja)](https://www.npmjs.com/package/emissaoja) [![CI](https://github.com/Easymovel/emissaoja-js/actions/workflows/ci.yml/badge.svg)](https://github.com/Easymovel/emissaoja-js/actions/workflows/ci.yml) [![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)](LICENSE)

Cliente oficial da **[API do emissaoja](https://emissaoja.com.br/docs/)** para emitir **NFS-e (Nota Fiscal de Serviço eletrônica) no Emissor Nacional** (nfse.gov.br) a partir do seu sistema, **sem certificado digital**: o emissaoja entra no portal com o CNPJ e a senha da própria empresa. Feito para **MEI e empresas do Simples Nacional**. Cadastre tomadores pelo CNPJ (nome e endereço vêm da Receita Federal), emita, acompanhe a autorização, baixe o **PDF (DANFSe) e o XML** e cancele notas.

- ESM com tipos TypeScript, **zero dependências**. Node.js 18+ e qualquer runtime com `fetch` (Deno, Bun, Cloudflare Workers).
- **Idempotência embutida:** toda emissão leva uma `referencia` sua, que vira o cabeçalho `Idempotency-Key`. Repetir a mesma referência nunca emite duas notas.
- `notas.aguardar()` acompanha o pedido até `autorizada`, `recusada` ou `incerta`, no ritmo que a API indica (`proxima_consulta_ms`).
- Erros com `code` estável (`nota_bloqueada`, `limite_notas`, `possivel_duplicada`…) e o que falta resolver em `extras.bloqueios`.
- **Sandbox grátis** com Emissor Nacional simulado: teste o fluxo inteiro sem efeito fiscal.

## Instalação

```bash
npm install emissaoja
```

Crie a conta com o Google em [emissaoja.com.br](https://emissaoja.com.br/?origem=lib-npm) e gere a chave em **Conta → API** (ela aparece uma vez; prefixo `ej_live_`). Guarde a chave no servidor:

```bash
export EMISSAOJA_KEY=ej_live_...
```

## Teste no sandbox em 2 minutos

O sandbox (`https://sandbox.emissaoja.com.br`) é o mesmo emissaoja com um **Emissor Nacional simulado**: nada ali existe no fisco e nada é cobrado. Entre com o Google, crie uma chave `ej_test_` em Conta → API e rode:

```js
import { Emissaoja, BASE_SANDBOX } from 'emissaoja';

const ej = new Emissaoja({ chave: process.env.EMISSAOJA_KEY, baseUrl: BASE_SANDBOX });

// 1. Conectar a empresa (uma vez). 11111111000191 é um MEI de exemplo pronto para emitir; qualquer senha serve.
await ej.empresa.conectar({ cnpj: '11111111000191', senha: 'senha-de-teste' });
await ej.empresa.aguardarCredencial();

// 2. Tomador pelo CNPJ: nome e endereço vêm da Receita Federal
const { tomador } = await ej.tomadores.criar({ documento: '12345678000195' });

// 3. Emitir (prévia + emissão num passo). A referência é o seu id da nota.
const { pedido } = await ej.notas.emitir({
  referencia: 'pedido-2026-11-0001',
  tomador_tipo: tomador.tipo,
  tomador_id: tomador.id,
  valor: 1500,
  descricao: 'Consultoria em marketing digital - novembro/2026',
});

// 4. Acompanhar até autorizada | recusada | incerta
const { pedido: final } = await ej.notas.aguardar(pedido.id);
console.log(final.estado, final.numero, final.chave_acesso);

// 5. PDF (DANFSe) e XML
if (final.estado === 'autorizada') {
  const pdf = await ej.notas.pdf(final.nota.origem, final.nota.id); // Uint8Array
  const xml = await ej.notas.xml(final.nota.origem, final.nota.id); // string
}
```

Valores com significado no sandbox: `13.13` gera uma nota **incerta** que `ej.emissoes.conferir(id)` resolve como autorizada, `77.77` uma incerta que não saiu, `66.66` uma **recusada** pelo fisco e `99.99` um **bloqueio** já na prévia (`422 nota_bloqueada`). Outras empresas de exemplo: `22222222000191` (ME que pede a alíquota do Simples antes de emitir), `33333333000191` (MEI sem notas anteriores) e `44444444000191` (bloqueada). A senha `errada` simula senha recusada pelo portal. Um exemplo completo está em [`exemplos/emitir-nfse-sandbox.mjs`](exemplos/emitir-nfse-sandbox.mjs).

## Em produção

Troque a base e a chave: `new Emissaoja({ chave: process.env.EMISSAOJA_KEY })` usa `https://emissaoja.com.br`. A chave `ej_live_` vale para a empresa e o plano da conta que a criou; chaves `ej_test_` só valem no sandbox.

> **A chave é secreta.** Use o pacote só no servidor (backend, funções serverless, filas). Nunca coloque a chave em código que roda no navegador ou em app distribuído: quem tiver a chave emite notas em nome da empresa.

## Empresa: conectar ao Emissor Nacional

```js
await ej.empresa.conectar({ cnpj: '11222333000181', senha: 'senha-do-emissor-nacional' }); // 202, verificação em segundo plano
const { tentativa } = await ej.empresa.aguardarCredencial();
// tentativa.proximo_passo: configurando | pronto | corrigir_senha | tentar_mais_tarde | redefinir_no_portal | suporte

const { onboarding } = await ej.empresa.obter(); // onboarding.estado: configurando → perguntas → pronto
if (onboarding.estado === 'perguntas') {
  console.log(await ej.empresa.onboarding()); // o que o cadastro fiscal não respondeu sozinho
  await ej.empresa.fiscal({ aliquota_simples: 6 }); // só com o valor que a empresa informou
}
```

A senha é conferida no portal e nunca volta em resposta. O portal bloqueia a conta da empresa depois de algumas senhas erradas: a API limita a 3 tentativas erradas por CNPJ em 24 h.

## Tomadores e serviços

```js
await ej.tomadores.criar({ documento: '52998224725', nome: 'Maria da Silva' }); // CPF precisa do nome
const { tomadores } = await ej.tomadores.listar({ busca: 'alfa', ordem: 'recentes' });
await ej.tomadores.buscar('12.345.678');

const { itens } = await ej.servicos.catalogo('consultoria'); // código nacional (cTribNac) por texto
await ej.servicos.criar({ descricao: 'Consultoria', c_trib_nac: itens[0].c_trib_nac, trib_issqn: 'tributavel', retem_iss: false });
const { servicos } = await ej.servicos.listar(); // emitir sem servico_id usa o principal
```

## Notas

```js
const { notas, proximo_cursor } = await ej.notas.listar({ periodo: 'mes_atual', situacao: 'emitidas' });
const { operacao } = await ej.notas.cancelar('local', notaId, { motivo: '1', justificativa: 'Valor digitado errado.' });
await ej.operacoes.aguardar(operacao.id); // processando → concluida | falhou
```

Nota não se altera: para corrigir, cancele e emita outra. Nota autorizada e depois cancelada conta no plano; recusada não conta.

## Idempotência e nota em dobro

- Use uma `referencia` por nota que você quer emitir (o id do seu pedido serve; 8 a 64 caracteres: letras, números, `_` e `-`). Repetir a mesma devolve o mesmo `pedido` com `repetido: true`.
- `503 fila_indisponivel`: repita **com a mesma referência**.
- `409 possivel_duplicada`: já existe nota igual (tomador, valor e competência) no mesmo dia. Se for mesmo outra nota, repita com `permitir_repetida_de: e.extras.nota_igual_recente.pedido_id`.
- `409 emissao_repetida_recente`: mesma nota há menos de 2 minutos. Se for intencional, repita com `confirmo_repeticao: true`.
- A biblioteca não repete chamadas sozinha: emitir tem efeito fiscal, e quem decide repetir é você.

## Erros

```js
import { EmissaojaErro } from 'emissaoja';

try {
  await ej.notas.emitir({ referencia: 'pedido-0002', tomador_tipo: 'pj', tomador_id: id, valor: 100 });
} catch (e) {
  if (!(e instanceof EmissaojaErro)) throw e;
  if (e.code === 'nota_bloqueada') console.log(e.extras.bloqueios); // [{ code, mensagem, acao }]
  else if (e.code === 'limite_notas') console.log('limite do plano no mês');
  else console.error(e.status, e.code, e.message, e.requestId);
}
```

| HTTP | `code` | O que fazer |
| --- | --- | --- |
| 400 | `validation_error`, `valor_invalido`, `cnpj_invalido`, `chave_idempotencia_invalida` | Corrigir o campo |
| 401 | `chave_invalida` | Conferir a chave (ou o ambiente: `ej_test_` só no sandbox) |
| 402 | `limite_notas` | Limite do plano no mês |
| 404 | `tomador_nao_encontrado`, `servico_nao_encontrado`, `nota_nao_encontrada`, `pedido_nao_encontrado` | Conferir o id |
| 409 | `sem_empresa`, `aceite_pendente`, `possivel_duplicada`, `emissao_repetida_recente`, `incerta_pendente` | Ver a seção acima |
| 422 | `nota_bloqueada` | Resolver `extras.bloqueios` |
| 429 | `rate_limited` | Esperar `Retry-After` |
| 503 | `motor_indisponivel`, `fila_indisponivel`, `receita_indisponivel` | Tentar de novo (com a mesma referência) |
| 0 | `rede`, `tempo_esgotado` | Falha de rede ou tempo esgotado no seu lado |

Limites: 60 chamadas por minuto por chave, 10 emissões por minuto e 120 por minuto em buscas e catálogo.

## Referência

| Recurso | Métodos |
| --- | --- |
| `empresa` | `obter`, `conectar`, `credencial`, `aguardarCredencial`, `onboarding`, `fiscal`, `relerFisco` |
| `tomadores` | `listar`, `buscar`, `criar`, `obter`, `atualizar` |
| `servicos` | `listar`, `criar`, `atualizar`, `desativar`, `catalogo` |
| `notas` | `emitir`, `aguardar`, `listar`, `pdf`, `xml`, `cancelar` |
| `emissoes` | `obter`, `listar`, `conferir` |
| `operacoes` | `obter`, `aguardar` |
| `cnpj` | `consultar` (dados da Receita Federal) |
| — | `status()` (sem chave) |

Opções do construtor: `chave` (padrão `EMISSAOJA_KEY`), `baseUrl` (`BASE_PRODUCAO` ou `BASE_SANDBOX`), `timeoutMs` (30000), `fetch`. Referência completa da API: [emissaoja.com.br/docs](https://emissaoja.com.br/docs/) e [OpenAPI 3.1](https://emissaoja.com.br/v1/openapi.json).

## Perguntas frequentes

**Precisa de certificado digital?** Não. O emissaoja entra no Emissor Nacional com o CNPJ e a senha do portal da própria empresa, o acesso que o portal oferece a MEI e empresas do Simples Nacional.

**Funciona para MEI?** Sim. O público é MEI, ME e EPP optantes pelo Simples Nacional, em um município que emite pelo Emissor Nacional.

**Tem ambiente de testes?** Sim, o sandbox em `https://sandbox.emissaoja.com.br`, com o Emissor Nacional simulado e empresas de exemplo.

**Quanto custa?** O plano Grátis emite 1 nota por mês; os planos pagos estão em [emissaoja.com.br/#precos](https://emissaoja.com.br/#precos). O sandbox é grátis. Nota recusada não conta.

**Tem webhook?** Ainda não. Acompanhe o pedido com `notas.aguardar()` ou `emissoes.obter()`, que trazem `proxima_consulta_ms`.

## Outras formas de integrar

- Python: [`pip install emissaoja`](https://github.com/Easymovel/emissaoja-py) · PHP/Laravel: [`composer require emissaoja/emissaoja`](https://github.com/Easymovel/emissaoja-php) · .NET: [`dotnet add package Emissaoja`](https://github.com/Easymovel/emissaoja-dotnet) · Go: [`go get emissaoja.com.br/go`](https://github.com/Easymovel/emissaoja-go) · Ruby: [`gem install emissaoja`](https://github.com/Easymovel/emissaoja-ruby)
- n8n: [`n8n-nodes-emissaoja`](https://github.com/Easymovel/n8n-nodes-emissaoja) · WooCommerce: [emissaoja NFS-e para WooCommerce](https://github.com/Easymovel/emissaoja-woocommerce)
- Assistentes de IA (Claude, ChatGPT, Cursor, VS Code): servidor MCP em `https://emissaoja.com.br/mcp` ([emissaoja-mcp](https://github.com/Easymovel/emissaoja-mcp))
- Documentação para IAs: [llms.txt](https://emissaoja.com.br/llms.txt) · [docs.md](https://emissaoja.com.br/docs.md)

## In English

Official Node.js/TypeScript client for the [emissaoja API](https://emissaoja.com.br/docs/): issue Brazilian **NFS-e** (electronic service invoices) through the national **Emissor Nacional** without a digital certificate, for MEI and Simples Nacional companies. Zero dependencies, typed, idempotent issuing, PDF and XML download, and a free sandbox with a simulated tax authority. The API and the docs are in Portuguese.

---

Suporte: [suporte@emissaoja.com.br](mailto:suporte@emissaoja.com.br). Licença MIT, © 2026 BINOBO LTDA.

O emissaoja é um serviço privado e não tem vínculo com a Receita Federal nem com o Emissor Nacional.
