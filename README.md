# Grafite — Bloco de Notas

Bloco de notas online pessoal

As notas ficam gravadas no localStorage do navegador em que você usa o app. Elas não sincronizam entre dispositivos. Use o botão **Backup** na barra lateral para exportar tudo em JSON periodicamente.

## Funcionalidades

- Quatro tipos de nota: texto simples, texto formatado, Markdown (com visualização) e lista de tarefas com progresso
- Salvamento automático enquanto digita (Ctrl+S força o salvamento)
- Busca por título e conteúdo, ordenação por data ou alfabética
- Coleções para agrupar notas, com filtro na barra lateral
- Histórico de versões por nota (snapshot automático a cada alteração, com intervalo mínimo de 5 minutos, até 20 versões, com restauração)
- Lixeira com restauração e exclusão definitiva
- Exportação em TXT, Markdown, HTML, Word (.doc) e PDF (via imprimir)
- Importação de arquivos .txt e .md
- Compartilhamento por link:
  - **Link simples**: a nota viaja codificada em base64url no fragmento da URL (`#n=...`)
  - **Protegido por senha**: conteúdo cifrado com AES-256-GCM, chave derivada por PBKDF2 (SHA-256, 150.000 iterações), executado no navegador via WebCrypto (`#s=...`)
- Backup e restauração completos em JSON
- Modo foco, temas sistema/claro/escuro, contagem de palavras e caracteres

