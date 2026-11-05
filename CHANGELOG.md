# Changelog

## 0.1.0 — 2026-11-05

Primeira versão pública do cliente oficial da API do emissaoja para Node.js e TypeScript.

- Recursos `empresa`, `tomadores`, `servicos`, `notas`, `emissoes`, `operacoes`, `cnpj` e `status()`, com tipos TypeScript.
- `notas.emitir` exige `referencia` (vira o cabeçalho `Idempotency-Key`) e valida o formato antes de chamar a API.
- `notas.aguardar`, `empresa.aguardarCredencial` e `operacoes.aguardar` respeitam `proxima_consulta_ms`.
- Erros da API viram `EmissaojaErro` com `status`, `code`, `extras` e `requestId`.
- Constantes `BASE_PRODUCAO` e `BASE_SANDBOX`.
