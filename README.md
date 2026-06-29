# Mandarena

A Mandarin Chinese learning game: a Bingo / Gomoku board of Chinese words where
players **speak** a word to claim its square. First to five in a row wins.

> ## Acknowledgement
> This project is a **fork of [yanranchu-rgb/mandarena](https://github.com/yanranchu-rgb/mandarena)**,
> originally created by **[@yanranchu-rgb](https://github.com/yanranchu-rgb)**.
> All original game design, artwork, sounds, and the initial implementation are
> their work. The upstream repository's commit history is preserved here.
> This fork adds the features listed below.
>
> The original repository remains linked as the `upstream` git remote.

## Play
- **Live:** https://mandarena-yanranchu.fly.dev
- **Local (same device):** open `/game`
- **Online (two devices):** open `/online`, create a room, share the code

Speech recognition works best in **Google Chrome** with a microphone.

## What this fork adds
- **Online PvP with rooms** — create a 4-letter room code, a friend joins from
  another device, and the server keeps both boards in sync (Flask-SocketIO).
- **10,969-word leveled word bank** (HSK 3.0) with a "use random" picker:
  - Level 1 — HSK 1–2 (beginner)
  - Level 2 — HSK 3–4 (elementary)
  - Level 3 — HSK 5–6 (intermediate)
  - Level 4 — HSK 7–9 (advanced)
- **Custom vocabulary** — paste any word list; the board auto-sizes (3×3 to 10×10).
- **Better single-syllable recognition** — interim results plus toneless-pinyin
  matching, so homophones (是/事, 四/寺 …) count and short words don't need dragging.

## Run locally
```bash
pip install -r requirements.txt
python app.py            # http://localhost:8080
```

## Tech
Flask · Flask-SocketIO · vanilla JS · Web Speech API · deployed on Fly.io.

## Credits & data
- Original game: **[@yanranchu-rgb](https://github.com/yanranchu-rgb)**
- HSK vocabulary: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary)
- Pinyin data: [mozillazg/pinyin-data](https://github.com/mozillazg/pinyin-data)
