# Fokus-Tracker → umgezogen

Seit Oktober 2026 gibt es den Fokus-Tracker nicht mehr als eigene App.
Gewohnheiten, Verlauf, Statistik und der Pomodoro-Timer sind Teil der
ToDo-Liste: **[todo.it-wolf.org](https://todo.it-wolf.org)** — im
Kalender-Streifen (Reiter „Gewohnheiten“ und „Timer“) und im Fenster
„Gewohnheiten“. Deine Daten sind dieselben, sie lagen schon immer in derselben
Datenbank.

`fokus.it-wolf.org` leitet dorthin weiter. Das erledigt
`functions/[[pfad]].js`; alles andere aus diesem Repo ist entfernt. Den Stand
der eigenständigen App findest du in der Git-Historie (letzter Stand vor dem
Umzug: Commit `63354a3`).

`BETRIEB.md` bleibt als Nachschlagewerk stehen: die Regeln darin (Flamme,
Obergrenze, „ruht“, Rhythmus) gelten weiter, nur liegt der Code jetzt in
`ToDo/web` (`functions/_lib/tag.js`, `heute.js`, `fokus.js` und die
Endpunkte unter `functions/api/gewohnheiten/` und `functions/api/fokus/`).
Die SQL-Dateien sind die Geschichte der gemeinsamen Datenbank; das aktuelle
Schema steht in `ToDo/web/schema-fokus.sql`.
