// Emite uma NFS-e de teste no sandbox do emissaoja (Emissor Nacional simulado: nada vai ao fisco).
//
// 1. Entre em https://sandbox.emissaoja.com.br com o Google e crie uma chave em Conta → API (começa com ej_test_).
// 2. npm install emissaoja
// 3. EMISSAOJA_KEY=ej_test_... node emitir-nfse-sandbox.mjs
import { writeFile } from 'node:fs/promises';
import { Emissaoja, EmissaojaErro, BASE_SANDBOX } from 'emissaoja';

const ej = new Emissaoja({ baseUrl: BASE_SANDBOX }); // a chave vem de EMISSAOJA_KEY

try {
  // 1. Conectar a empresa (uma vez). No sandbox, 11111111000191 é um MEI pronto para emitir e qualquer senha serve.
  const { credencial } = await ej.empresa.obter();
  if (credencial.estado !== 'ativa') {
    await ej.empresa.conectar({ cnpj: '11111111000191', senha: 'senha-de-teste' });
    const { tentativa } = await ej.empresa.aguardarCredencial();
    console.log('Credencial:', tentativa?.proximo_passo);
  }

  // 2. Tomador pelo CNPJ: nome e endereço vêm da Receita Federal.
  const { tomador } = await ej.tomadores.criar({ documento: '12345678000195' });

  // 3. Emitir. A referência é o seu id da nota: repetir a mesma nunca emite duas vezes.
  const { pedido } = await ej.notas.emitir({
    referencia: `exemplo-${Date.now()}`,
    tomador_tipo: tomador.tipo,
    tomador_id: tomador.id,
    valor: 150,
    descricao: 'Consultoria em marketing digital',
  });

  // 4. Acompanhar até autorizada, recusada ou incerta.
  const { pedido: final } = await ej.notas.aguardar(pedido.id);
  console.log(final.estado, final.numero ?? '', final.chave_acesso ?? '');

  // 5. Baixar o PDF (DANFSe) e o XML.
  if (final.estado === 'autorizada') {
    await writeFile(`nfse-${final.numero}.pdf`, await ej.notas.pdf(final.nota.origem, final.nota.id));
    await writeFile(`nfse-${final.numero}.xml`, await ej.notas.xml(final.nota.origem, final.nota.id));
  }
} catch (e) {
  if (e instanceof EmissaojaErro) {
    console.error(e.status, e.code, e.message, e.extras.bloqueios ?? '');
    process.exitCode = 1;
  } else {
    throw e;
  }
}
