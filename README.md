# Flora Medici 🌿 – Dein Pflanzendoktor

Handy-App (Progressive Web App), die anhand von Fotos erkennt, **was deiner Pflanze fehlt** – zu nass, zu trocken,
zu dunkel, Schädlinge, Krankheiten – und dir persönlich erklärt, was du tun kannst.

## Funktionen

- 📷 1–3 Fotos (ganze Pflanze, Problemstelle, Erde/Blattunterseite) per Kamera oder Galerie
- 🌱 Bestimmung der Pflanze **mit Prozent-Sicherheit** und Alternativen
- 🍂 **Erkennt natürliche Vorgänge** (normaler Blattwurf alter Blätter, Herbstlaub, Winterruhe, Einziehen nach der Blüte, Reaktion auf Umstellen) und unterscheidet sie von echten Problemen
- 🩺 Diagnose mit Symptomen, möglichen Ursachen (jeweils mit Wahrscheinlichkeit) und konkreten Maßnahmen
- 💬 Persönlicher Ton („Was wir hier sehen, ist eine … Deine Pflanze liebt …“)
- ❓ Bei Unsicherheit: Rückfragen und gezielte Fotowünsche, die man direkt beantworten kann
- 🤔 **Jeder Treffer kann jederzeit hinterfragt werden** – die KI prüft neu und begründet ihre Antwort
- 🐾 Hinweis zur Giftigkeit für Haustiere/Kinder
- 📚 Verlauf „Meine Pflanzen“ – lokal auf dem Gerät gespeichert
- 🔄 **Automatische Updates bei jedem Start** (Service Worker, „Network first“)
- 📴 App-Oberfläche funktioniert auch offline (Analyse braucht Internet)

## Kosten: 0 €

| Baustein | Lösung | Kosten |
|---|---|---|
| App | PWA (läuft auf iPhone & Android, kein App Store nötig) | 0 € |
| Hosting & Updates | GitHub Pages (öffentliches Repo) | 0 € |
| KI-Bildanalyse | Google Gemini API, Free Tier | 0 € (Tageslimit) |

> Ein ChatGPT-Abo (auch das kostenlose) lässt sich technisch nicht in eigene Apps einbinden – die OpenAI-API ist separat
> und kostenpflichtig. Gemini bietet dagegen ein kostenloses API-Kontingent mit Bildanalyse.

## Einrichtung (einmalig)

### 1. Veröffentlichen über GitHub Pages
1. GitHub → Repository → **Settings → Pages** → *Source: Deploy from a branch*.
2. Branch `claude/faunamedic-plant-diagnosis-hqow57`, Ordner `/ (root)` → **Save**.
3. Nach ca. 1 Minute ist die App erreichbar unter: `https://ziege1988.github.io/FaunaMedic/`

### 2. Auf dem Handy installieren
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm“
- **Android (Chrome):** Seite öffnen → Menü ⋮ → „App installieren“

### 3. Kostenlosen KI-Schlüssel hinterlegen
1. <https://aistudio.google.com/apikey> öffnen, mit Google-Konto anmelden, „API-Schlüssel erstellen“, dann über „Copy key“ vollständig kopieren (neue Schlüssel beginnen mit `AQ.`).
2. In Flora Medici → ⚙️ Einstellungen → Schlüssel einfügen → „Testen“ → „Speichern“.
3. **Kein Billing in Google AI Studio aktivieren** – dann bleibt es garantiert kostenlos.

Die App wählt das KI-Modell automatisch („auto“) und weicht bei Kontingent-Grenzen auf andere kostenlose Modelle aus.

## Updates veröffentlichen

Einfach Änderungen auf den bei Pages eingestellten Branch pushen. Beim nächsten App-Start lädt der Service Worker die neue Version und
lädt die App einmal neu. Optional `APP_VERSION` in `app.js` und `CACHE_VERSION` in `sw.js` erhöhen.

## Datenschutz

- Fotos werden nur zur Analyse an die Google Gemini API gesendet. Im Free Tier darf Google Inhalte zur
  Produktverbesserung nutzen → keine Fotos mit Personen/privaten Details.
- API-Schlüssel und Verlauf liegen ausschließlich lokal auf dem Gerät (localStorage / IndexedDB).

## Projektstruktur

```
index.html            App-Gerüst
styles.css            Design (Pastellgrün · Grau · Weiß)
app.js                Logik, KI-Anbindung, Ansichten
sw.js                 Service Worker (Auto-Update, Offline)
manifest.webmanifest  Installierbarkeit (Name, Icons, Farben)
icons/                Logo (SVG) + App-Icons (PNG)
```
