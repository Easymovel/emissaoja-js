// Teste de integração contra o sandbox público (https://sandbox.emissaoja.com.br, Emissor Nacional simulado).
// Só roda com EMISSAOJA_TEST_KEY (uma chave ej_test_ criada em Conta → API no sandbox); sem ela, é pulado.
//   EMISSAOJA_TEST_KEY=ej_test_... node --test test/integracao.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emissaoja, BASE_SANDBOX } from '../src/index.js';

const chave = process.env.EMISSAOJA_TEST_KEY;

test('sandbox: empresa de exemplo, tomador, emissão e PDF', { skip: !chave && 'defina EMISSAOJA_TEST_KEY para rodar' }, async () => {
  const ej = new Emissaoja({ chave, baseUrl: BASE_SANDBOX });
  assert.equal((await ej.status()).motor, 'simulado');

  const { credencial } = await ej.empresa.obter();
  if (credencial.estado !== 'ativa') {
    await ej.empresa.conectar({ cnpj: '11111111000191', senha: 'qualquer' });
    await ej.empresa.aguardarCredencial({ timeoutMs: 60_000 });
  }

  const { tomador } = await ej.tomadores.criar({ documento: '12345678000195' });
  const referencia = `sdk-js-${Date.now()}`;
  const { pedido } = await ej.notas.emitir({ referencia, tomador_tipo: tomador.tipo, tomador_id: tomador.id, valor: 10, descricao: 'Teste do cliente JavaScript' });
  const { pedido: final } = await ej.notas.aguardar(pedido.id, { timeoutMs: 120_000 });
  assert.ok(['autorizada', 'recusada', 'incerta'].includes(final.estado));
  if (final.estado === 'autorizada') {
    const pdf = await ej.notas.pdf(final.nota.origem, final.nota.id);
    assert.equal(new TextDecoder().decode(pdf.slice(0, 4)), '%PDF');
  }
});
