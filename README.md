# Haushalt – Einnahmen & Ausgaben Tracker

Leichtgewichtiger, mobiler Privat-Tracker mit KI-Unterstützung (Google Gemini), Spracheingabe und Beleg-Scan.

## Features

- **Mobile-first** Web-UI (PWA-tauglich, Kamera für Belege)
- **App-Passwort** aus `.env` schützt die Installation
- **Mehrere Benutzer** – serverseitige Profile, nutzbar in verschiedenen Browsern/Geräten
- **KI-Erfassung** via `gemini-3.5-flash`: Sprachtext und Belegfotos → vorausgefülltes Formular
- **Analyse**: Monatssaldo, 6-Monats-Trend, Kategorie-Ausgaben
- **SQLite** – keine externe Datenbank nötig

## Voraussetzungen

- Node.js 20+
- [Google AI Studio API Key](https://aistudio.google.com/apikey) für KI-Funktionen

## Installation

```bash
cp .env.example .env
# .env bearbeiten: APP_PASSWORD, SESSION_SECRET, GEMINI_API_KEY

npm install
npm start
```

Öffnen: **http://localhost:3847** (oder der in `PORT` gesetzte Wert)

## `.env` Variablen

| Variable | Beschreibung |
|----------|--------------|
| `APP_PASSWORD` | Zugangspasswort für die App |
| `SESSION_SECRET` | Langer Zufallsstring für signierte Cookies |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `GEMINI_MODEL` | Standard: `gemini-3.5-flash` (mit `thinkingLevel: minimal` für Speed) |
| `GEMINI_AUDIO_MODEL` | Optional schnelleres Modell nur für Sprach-Aufnahmen |
| `PORT` | Standard in `.env.example`: `3847` |

## Nutzung

1. Mit **App-Passwort** anmelden
2. **Profil** wählen oder neu anlegen (z.B. „Stephan“, „Partnerin“)
3. Buchungen manuell, per **Sprache** oder **Belegfoto** erfassen
4. KI-Vorschläge immer kurz prüfen, dann speichern
5. Tab **Analyse** für Trends und Kategorien

## Daten

- Datenbank: `data/finanzen.db`
- Belegbilder: `uploads/`

Beide Ordner sind in `.gitignore` und bleiben lokal.

## Entwicklung

```bash
npm run dev
```

Startet den Server mit automatischem Neustart bei Dateiänderungen.
