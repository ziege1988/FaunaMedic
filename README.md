# Flora Medici 🌿 – Dein Pflanzendoktor

Handy-App (Progressive Web App), die anhand von Fotos erkennt, **was deiner Pflanze fehlt**, dir persönlich erklärt,
was du tun kannst – und deine Pflanzen wie ein Hausarzt dauerhaft betreut.

## Funktionen

**Untersuchung**
- 📷 1–3 Fotos per Kamera oder Galerie, Standort und eigene Beobachtungen
- 🌱 Pflanzenbestimmung und Diagnose **mit Prozent-Sicherheit**, Ursachen mit Wahrscheinlichkeiten, konkrete Maßnahmen
- 🍂 Erkennt **natürliche Vorgänge** (normaler Blattwurf, Herbstlaub, Winterruhe, Einziehen, Umstell-Reaktion)
- 🛡️ **Zweitprüfung**: Jede Diagnose wird von einer zweiten, unabhängigen KI-Prüfung kritisch hinterfragt
- ❓ Rückfragen und Fotowünsche bei Unsicherheit; jeder Treffer kann jederzeit hinterfragt werden

**Betreuung wie beim Arzt**
- 📁 **Patientenakte** je Pflanze – bleibt gespeichert, bis du sie aktiv löschst
- 🗓️ **Behandlungsplan** mit Aufgaben für die nächsten Tage zum Abhaken
- 📸 **Kontrolltermine**: Die KI legt fest, wann ein neues Foto nötig ist, vergleicht Vorher/Nachher und bewertet den Verlauf
- 🔔 **Erinnerungen als iPhone-Mitteilung** (auch wenn die App geschlossen ist)
- 💬 **Sprechstunde**: jederzeit Fragen zur Pflanze stellen („Wie blüht sie prächtiger?“, „Wann und wie schneide ich sie?“)
- ✂️ Die KI **markiert direkt auf deinem eigenen Foto**, wo du schneiden sollst, plus Schemaskizze
- 📅 Termine aus Antworten (z. B. „Ende Februar schneiden“) als Erinnerung übernehmen

**Technik**
- 🔄 Automatische Updates bei jedem App-Start · 📴 Oberfläche auch offline nutzbar

## Kosten: 0 €

| Baustein | Lösung |
|---|---|
| App & Hosting | PWA auf GitHub Pages (öffentliches Repo) |
| KI | Google Gemini API, Free Tier |
| Mitteilungen | cron-job.org (Takt) → GitHub Actions (Versand) → Apple Push-Dienst |

---

## Anleitung: Mitteilungen einrichten (einmalig, ca. 15 Minuten)

So funktioniert es: Die App legt deine Erinnerungen verschlüsselt in GitHub ab. cron-job.org stößt alle 15 Minuten
den Workflow **„Flora Medici Push“** an. Dieser prüft, ob etwas fällig ist, und schickt die Mitteilung über den
Apple Push-Dienst an dein iPhone – genau wie bei deiner Solux-App.

Du brauchst **zwei** GitHub-Zugangsschlüssel (Tokens). Das ist sicherer und erspart dir das Übertragen
zwischen Computer und Handy: einen für cron-job.org (am Computer) und einen für die App (am iPhone).

### Teil 1 – Schlüssel für cron-job.org (am Computer)

1. Öffne <https://github.com/settings/personal-access-tokens/new> (ggf. anmelden).
2. **Token name:** `Flora Medici Cron`
3. **Expiration:** längste mögliche Laufzeit wählen (oder „No expiration“, falls angeboten).
4. **Repository access:** `Only select repositories` → **FaunaMedic** auswählen.
5. **Permissions** → **Repository permissions** (ggf. „Add permissions“):
   - **Actions** → `Read and write`
6. Ganz unten **Generate token** → Schlüssel (beginnt mit `github_pat_`) **kopieren**.
   ⚠️ GitHub zeigt ihn nur einmal an – Fenster offen lassen, bis Teil 2 fertig ist.

### Teil 2 – Taktgeber bei cron-job.org (am Computer)

1. Bei <https://cron-job.org> anmelden → **Cronjobs** → **Cronjob erstellen**.
2. **Titel:** `Flora Medici Push`
3. **URL:**
   ```
   https://api.github.com/repos/ziege1988/FaunaMedic/actions/workflows/push.yml/dispatches
   ```
4. **Ausführung:** alle **15 Minuten**.
5. Reiter **Erweitert**:
   - **Anfragemethode:** `POST`
   - **Header** (vier Stück, jeweils „Hinzufügen“):

     | Schlüssel | Wert |
     |---|---|
     | `Authorization` | `Bearer ` + dein Schlüssel aus Teil 1 (mit Leerzeichen nach Bearer) |
     | `Accept` | `application/vnd.github+json` |
     | `X-GitHub-Api-Version` | `2022-11-28` |
     | `Content-Type` | `application/json` |
   - **Anfrage-Body:**
     ```
     {"ref":"claude/faunamedic-plant-diagnosis-hqow57"}
     ```
6. **Speichern** → mit **Testlauf** prüfen: Erwartete Antwort ist **204** (= alles gut).
   Bei 401/403/404 bitte Header und URL kontrollieren.

### Teil 3 – Schlüssel für die App (am iPhone, in Safari)

1. In **Safari** öffnen: `github.com/settings/personal-access-tokens/new` (ggf. anmelden).
2. **Token name:** `Flora Medici App`, **Expiration:** längste Laufzeit.
3. **Repository access:** `Only select repositories` → **FaunaMedic**.
4. **Repository permissions:**
   - **Actions** → `Read and write`
   - **Secrets** → `Read and write`
5. **Generate token** → **kopieren**.

### Teil 4 – In der App aktivieren (am iPhone)

1. Flora Medici **über das Symbol auf dem Home-Bildschirm** öffnen (nicht in Safari – sonst gehen keine Mitteilungen).
2. **Zahnrad ⚙️** → Bereich **Erinnerungen (Mitteilungen)**.
3. **Uhrzeit** wählen, zu der du erinnert werden möchtest (z. B. 09:00).
4. Den Schlüssel aus Teil 3 in **GitHub-Zugangsschlüssel** einfügen.
5. **Mitteilungen einrichten** tippen → bei der iPhone-Frage **Erlauben** wählen.
6. Nach ca. 1–2 Minuten kommt die Mitteilung **„Test erfolgreich!“**. 🎉

Ab jetzt wirst du automatisch zur gewählten Uhrzeit an Aufgaben und Kontrolltermine erinnert.
Hakst du eine Aufgabe vorher ab, entfällt die Erinnerung. Tippst du auf eine Mitteilung, öffnet sich direkt die Pflanze.

### Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| „Bitte öffne Flora Medici über das Symbol …“ | App vom Home-Bildschirm starten, nicht aus Safari |
| „GitHub-Zugangsschlüssel ungültig“ | Schlüssel aus Teil 3 neu erstellen und einfügen |
| „Dem Schlüssel fehlen Rechte“ | Beim Token **Actions** und **Secrets** auf „Read and write“ stellen |
| Test-Mitteilung kommt nicht | GitHub → Repository → Reiter **Actions** → „Flora Medici Push“ → letzten Lauf öffnen und Meldung lesen |
| Mitteilungen erlaubt, aber nichts kommt | iPhone: Einstellungen → Mitteilungen → Flora Medici → „Mitteilungen erlauben“ an; Fokus/Nicht-stören prüfen |
| Nach einiger Zeit keine Mitteilungen mehr | Token abgelaufen → neu erstellen (Teil 1 bzw. 3) |

---

## Grundeinrichtung (bereits erledigt)

1. **GitHub Pages:** Settings → Pages → Branch `claude/faunamedic-plant-diagnosis-hqow57`, Ordner `/ (root)`.
2. **Installieren:** `https://ziege1988.github.io/FaunaMedic/` in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
3. **KI-Schlüssel:** <https://aistudio.google.com/apikey> → „API-Schlüssel erstellen“ → über „Copy key“ kopieren
   (beginnt mit `AQ.`) → in der App unter Einstellungen einfügen. **Kein Billing aktivieren.**

## Datenschutz

- Fotos werden nur zur Analyse an die Google Gemini API gesendet (Free Tier: Google darf Inhalte zur
  Produktverbesserung nutzen → keine Fotos mit Personen).
- Pflanzen, Fotos und Fragen liegen ausschließlich auf deinem Gerät (IndexedDB).
- Für Mitteilungen werden nur Erinnerungstexte (Pflanzenname, Aufgabe, Zeitpunkt) und die Geräte-Anmeldung
  **verschlüsselt** als GitHub-Secret gespeichert. Die Mitteilung selbst ist Ende-zu-Ende verschlüsselt.
  Im Actions-Protokoll erscheinen nur Anzahlen, keine Texte.

## Projektstruktur

```
index.html                    App-Gerüst
styles.css                    Design (Pastellgrün · Grau · Weiß)
js/main.js                    Ansichten: Untersuchung, Patientenakte, Sprechstunde, Einstellungen
js/ai.js                      KI-Anbindung: Diagnose, Zweitprüfung, Kontrolltermin, Fragen
js/reminders.js               Behandlungsplan, fällige Aufgaben, Mitteilungen (GitHub-Secrets)
js/db.js                      Lokale Datenbank (Patientenakten)
js/util.js                    Hilfsfunktionen
sw.js                         Service Worker: Auto-Update, Offline, Mitteilungen empfangen
.github/workflows/push.yml    Versand der Mitteilungen (gestartet durch cron-job.org)
scripts/send-push.mjs         Versandlogik (Web Push)
manifest.webmanifest, icons/  Installierbarkeit, Logo
```
