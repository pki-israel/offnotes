# Grafite — Bloco de Notas

Bloco de notas online pessoal, em paleta monocromática de tons de grafite, com temas claro e escuro. Sem servidor, sem conta, sem anúncios: um app estático que roda inteiro no navegador.

## Como usar

- Abra o `index.html` no navegador, ou
- Publique no GitHub Pages (Settings > Pages > Deploy from a branch) e acesse pela URL gerada.

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

## Estrutura

```
index.html    marcação da interface
styles.css    tema (tokens de cor claro/escuro), layout e componentes
app.js        armazenamento, editores, compartilhamento, criptografia
```

Não há dependências externas nem etapa de build.

## Notas de segurança

- Todo HTML de nota formatada passa por um sanitizador com lista de permissões antes de ser renderizado, inclusive conteúdo recebido por link compartilhado.
- No compartilhamento com senha, quem tem o link sem a senha vê apenas o ciphertext; o AES-GCM garante integridade, então senha errada falha na autenticação em vez de exibir conteúdo corrompido.
- O fragmento da URL (`#...`) não é enviado ao servidor em requisições HTTP, mas fica no histórico do navegador de quem abre o link.
