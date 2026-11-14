# MailFlow MCP Bridge

Ein kleiner Zusatzcontainer, der [MailFlow](https://github.com/maathimself/mailflow) für KI-Assistenten
(Claude, ChatGPT, Grok und andere MCP-fähige Programme) öffnet: **Mails lesen und Entwürfe ablegen.**
Gesendet wird nie – ein Entwurf liegt im Entwürfe-Ordner, bis ein Mensch ihn in MailFlow prüft und abschickt.

MailFlow selbst bleibt unverändert. Die Bridge nutzt nur die persönlichen API-Tokens, die MailFlow
dafür vorsieht, und kann deshalb auch nicht mehr als ein solches Token: kein Senden, kein Löschen,
keine Einstellungen.

## Was der Assistent kann

| Werkzeug | Zweck |
|---|---|
| `mailflow_list_accounts` | Postfächer des Nutzers |
| `mailflow_list_folders` | Ordner eines Postfachs |
| `mailflow_list_messages` | Mails eines Ordners (Kopfzeilen mit Vorschau) |
| `mailflow_search` | Suche, auch mit `from:`, `subject:` usw. |
| `mailflow_get_message` | eine Mail mit Text |
| `mailflow_get_thread` | die ganze Unterhaltung zu einer Mail |
| `mailflow_create_draft` | neuen Entwurf ablegen, auch als Antwort auf eine Mail |

Entwürfe sind reiner Text ohne Anhänge, und ein bestehender Entwurf lässt sich nicht überschreiben –
das sind Vorgaben von MailFlow für Tokens. Die Signatur des Postfachs hängt MailFlow selbst an.

## Einrichten

**1. API-Tokens in MailFlow einschalten** (einmalig, als Admin, in den Admin-Einstellungen).

**2. Token anlegen:** in MailFlow unter *Einstellungen → Sicherheit → API-Tokens*, mit den
Berechtigungen **Lesen** und **Entwürfe**. „Organisieren“ wird nicht gebraucht. Das Token beginnt
mit `mfat_` und wird nur einmal angezeigt. Jeder Nutzer legt sein eigenes an; Tokens laufen ab
(höchstens 365 Tage).

**3. Bridge starten:**

```bash
cp .env.example .env
docker network ls | grep mailflow     # Netzwerkname nach MAILFLOW_NETWORK in .env
docker compose up -d --build
curl http://127.0.0.1:3100/healthz    # {"ok":true}
```

**4. Per HTTPS erreichbar machen.** Die Bridge lauscht nur auf `127.0.0.1:3100`. Assistenten aus dem
Netz brauchen eine HTTPS-Adresse, also einen Eintrag im eigenen Reverse-Proxy, zum Beispiel mit Caddy:

```
mcp.example.com {
	reverse_proxy 127.0.0.1:3100
}
```

MailFlows eigene Caddy-Konfiguration steckt fest im Image und bleibt unberührt.

**5. Prüfen** (liest nur; mit `--draft` legt es einen Test-Entwurf ab):

```bash
npm ci
MAILFLOW_API_TOKEN=mfat_… node scripts/smoke.js https://mcp.example.com/mcp --draft
```

## Assistenten anbinden

Die Adresse ist `https://mcp.example.com/mcp` (Streamable HTTP). Das MailFlow-Token wird als
`Authorization: Bearer mfat_…` mitgeschickt; die Bridge reicht es an MailFlow durch und speichert
nichts. So nutzt jeder Nutzer sein eigenes Token an derselben Bridge.

Claude Code:

```bash
claude mcp add --transport http mailflow https://mcp.example.com/mcp \
  --header "Authorization: Bearer mfat_…"
```

Lokal ohne Netzwerk (z. B. Claude Desktop), als stdio-Prozess:

```json
{
  "mcpServers": {
    "mailflow": {
      "command": "node",
      "args": ["/pfad/zu/mailflow-mcp-caddy/src/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "MAILFLOW_URL": "https://mail.example.com",
        "MAILFLOW_API_TOKEN": "mfat_…"
      }
    }
  }
}
```

**Assistenten ohne eigenen Header.** Manche Oberflächen nehmen nur eine Adresse an. Dafür gibt es
den Ein-Nutzer-Modus: `MAILFLOW_API_TOKEN` und `MCP_URL_SECRET` (`openssl rand -hex 32`) in `.env`
setzen, dann lautet die Adresse `https://mcp.example.com/mcp/<MCP_URL_SECRET>`. Wer diese Adresse
kennt, liest die Mails dieses Nutzers – sie ist wie ein Passwort zu behandeln und landet in
Proxy-Logs. Wenn der Assistent einen Header schicken kann, ist das der bessere Weg.

## Sicherheit

- Die Bridge hat keine eigenen Rechte. Was erlaubt ist, entscheidet MailFlow anhand des Tokens;
  ein Token widerrufen (*Einstellungen → Sicherheit*) sperrt den Assistenten sofort.
- Der Inhalt fremder Mails landet beim Assistenten. Eine Mail kann Text enthalten, der den
  Assistenten zu etwas überreden will (Prompt Injection). Weil er nur lesen und Entwürfe ablegen
  kann, bleibt der Schaden begrenzt – Entwürfe vor dem Senden trotzdem lesen.
- Der Mail-Inhalt wird an den Anbieter des jeweiligen Assistenten übertragen.

## Entwicklung

```bash
npm ci
npm test        # gegen eine nachgebaute MailFlow-Schnittstelle
MAILFLOW_URL=http://localhost:3000 npm start
```

Die genutzten MailFlow-Routen stehen in `src/mailflow.js`; maßgeblich ist upstream
`backend/src/services/apiTokenAllowlist.js`.
