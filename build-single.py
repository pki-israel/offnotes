# Gera a versao de arquivo unico a partir dos tres arquivos separados,
# inlinando styles.css, app.js e o favicon (como data URI).
import io, os, urllib.parse

BASE = r"C:\Users\israel.rodrigues\OneDrive - soluti.com.br\Obsidian-Vault\6 - Obsidian-Claude-Vault\Projetos\grafite-bloco-de-notas"
OUT = [
    r"C:\Users\ISRAEL~1.ROD\AppData\Local\Temp\claude\C--Users-israel-rodrigues-OneDrive---soluti-com-br-Obsidian-Vault\cf56bb84-f65b-467a-8acf-cac4c47a24fb\scratchpad\grafite-bloco-de-notas.html",
    r"C:\Users\israel.rodrigues\OneDrive - soluti.com.br\Obsidian-Vault\6 - Obsidian-Claude-Vault\Projetos\Grafite - Bloco de Notas.html",
]

def read(name):
    with io.open(os.path.join(BASE, name), encoding="utf-8") as f:
        return f.read()

html = read("index.html")
css = read("styles.css").rstrip("\n")
js = read("app.js").rstrip("\n")
svg = read("favicon.svg")

# favicon como data URI: comprime espacos e faz percent-encode dos caracteres problematicos
svg_min = " ".join(svg.split())
data_uri = "data:image/svg+xml," + urllib.parse.quote(svg_min, safe="/:=-,.'() ").replace('"', "'")

head_start = html.index("<head>") + len("<head>")
head_end = html.index("</head>")
head = html[head_start:head_end]

body_start = html.index("<body>") + len("<body>")
body_end = html.rindex("</body>")
body = html[body_start:body_end]

head = head.replace(
    '<link rel="icon" type="image/svg+xml" href="favicon.svg">',
    '<link rel="icon" type="image/svg+xml" href="%s">' % data_uri,
)
head = head.replace(
    '<link rel="stylesheet" href="styles.css">',
    "<style>\n%s\n</style>" % css,
)
body = body.replace(
    '<script src="app.js"></script>',
    "<script>\n%s\n</script>" % js,
)

single = head.strip("\n") + "\n" + body.strip("\n") + "\n"

for path in OUT:
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(single)

assert "styles.css" not in single and "app.js" not in single, "sobrou referencia externa"
assert "favicon.svg" not in single, "favicon nao foi inlinado"
# </script> dentro do JS encerraria o bloco inline antes da hora
assert "</script>" not in js, "app.js contem </script> literal"
print("ok -", len(single), "chars")
print("favicon data URI:", len(data_uri), "chars")
