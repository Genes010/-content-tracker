# Content Tracker

Gedeelde tracker voor showcontent tussen content maker en media server. Vervangt de "Content"-sheet: per song welke files er zijn, welke versie op Dropbox staat en welke versie op de server is ingeladen.

![flow](https://img.shields.io/badge/Dropbox-%E2%86%92-blue) content maker uploadt `_v02` → tracker ziet "nieuw op Dropbox" → jij downloadt, laadt in, klikt **⇩** (of scan doet het automatisch).

## Functies

- Songs met files: naam, scherm, type (LOOP/LINEAR/STILL/NOTCH), omschrijving, comments, cam mask
- Versie **on Dropbox** en **on Server** per file; rij kleurt oranje als Dropbox nieuwer is
- **Scan mappen**: zoekt in je lokaal gesynchte Dropbox-map en je media-map naar de hoogste `_v##` per file en vult beide versies automatisch in (submappen inbegrepen, elke extensie)
- Links: **↗** opent de file in Dropbox web, **📁** toont de file in Verkenner (op de server zelf) of kopieert het pad
- Live updates tussen alle open browsers, activiteitenlog met naam per wijziging
- Filters (to do / nieuw op Dropbox / nog niet klaar), zoeken, meerdere projecten
- Import van de bestaande Google Sheet (CSV) en export naar CSV
- Data als JSON in `data/` met dagelijkse backup

## Installeren (Windows server)

1. Installeer [Node.js LTS](https://nodejs.org)
2. Clone de repo en dubbelklik `start.bat` (installeert de eerste keer zelf)
3. Open `http://localhost:3080`

Instellingen via `config.json` (kopieer `config.example.json`) of omgevingsvariabelen:

| Optie | Env | Default | |
|---|---|---|---|
| `port` | `PORT` | 3080 | |
| `password` | `APP_PASSWORD` | – | gedeeld wachtwoord (browser login), aanbevolen |
| `autoScanMinutes` | `AUTO_SCAN_MINUTES` | 0 | automatisch scannen elke N minuten |
| `allowRemoteOpen` | `ALLOW_REMOTE_OPEN` | false | "toon in Verkenner" ook vanaf andere pc's (opent op de server) |
| `dataFile` | `DATA_FILE` | `data/data.json` | |

## Eerste keer

1. Google Sheet → **Bestand → Downloaden → CSV** van het content-tabblad
2. In de tracker: **Importeer sheet** → kies het bestand
3. **Instellingen** → vul de mappen in:
   - *Dropbox map in de cloud*: pad zoals in Dropbox web, bv. `/DI-RECT/Ahoy 2026/Content` (voor de ↗ links)
   - *Dropbox lokaal*: dezelfde map gesynct op de server, bv. `D:\Dropbox\DI-RECT\Ahoy 2026\Content`
   - *Lokale media-map*: waar Pixera de content leest, bv. `E:\PIXERA\DIR26\Content`
4. **Scan mappen**

## Toegang voor de content maker

De app draait op jouw server. Geef de content maker toegang via bijv. [Tailscale](https://tailscale.com) (gratis, geen poorten openzetten) of een Cloudflare Tunnel, en zet een wachtwoord. Zij hoeft alleen een browser.

## Naamconventie

`PREFIX_###_Omschrijving_vXX` — de tracker matcht files op alles vóór `_v##`, case-insensitive. `TAC_201_Lines_vXX` vindt `TAC_201_Lines_v03.mov`. Knop **⧉** dupliceert een rij met het volgende nummer.

## Structuur

```
server.js            Express API + SSE + statische files
lib/store.js         JSON opslag (atomic write + dagbackup)
lib/scanner.js       mappen scannen op _v## versies
lib/csv-import.js    Google Sheet CSV import
public/              frontend (vanilla JS, geen build)
scripts/import.js    CLI import
```
