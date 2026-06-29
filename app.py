from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import os
import random
import string
import re
import threading

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "mandarena-secret-change-me")

# cors_allowed_origins="*" so it also works when opened from a different host/device.
socketio = SocketIO(app, cors_allowed_origins="*")

# 150 HSK1 words (default vocabulary)
HSK_WORDS = [
    "爱","八","爸爸","杯子","北京","本","不","不客气","菜","茶","吃",
    "出租车","打电话","大","的","点","电脑","电视","电影","东西","都",
    "读","对不起","多","多少","儿子","二","饭馆","飞机","分钟","高兴",
    "个","工作","狗","汉语","好","喝","和","很","后面","回","会","火车站",
    "几","家","叫","她","今天","九","开","看","看见","块","来","老师","冷",
    "里","了","零","六","妈妈","吗","买","猫","没","没关系","米饭","名字",
    "明天","哪","那","呢","能","你","年","女儿","朋友","漂亮","苹果","七",
    "前面","钱","请","去","热","人","认识","日","三","商店","上","上午","少",
    "十","什么","时候","是","书","谁","水","水果","睡觉","说话","四","岁",
    "他","太","天气","听","同学","喂","我","我们","五","喜欢","下","下午",
    "下雨","先生","现在","想","小","小姐","些","写","谢谢","星期","学生",
    "学习","学校","一","衣服","医生","医院","椅子","有","月","再见","在",
    "怎么","怎么样","这","中国","中午","住","桌子","字","昨天","坐","做"
]

# ====== Board / vocabulary helpers ======
# (min_word_count, columns, in-a-row needed to win)
BOARD_TIERS = [
    (100, 10, 5),
    (81, 9, 5),
    (64, 8, 5),
    (49, 7, 4),
    (36, 6, 4),
    (25, 5, 4),
    (16, 4, 3),
    (9, 3, 3),
]
MIN_WORDS = 9


def clean_words(raw):
    """Parse a pasted vocabulary blob into a de-duplicated list of words.

    Accepts words separated by newlines, spaces, commas (Latin or Chinese),
    semicolons or the Chinese enumeration comma.
    """
    parts = re.split(r"[\s,，、;；]+", raw or "")
    out, seen = [], set()
    for p in parts:
        w = p.strip()
        if w and w not in seen:
            seen.add(w)
            out.append(w)
    return out


def pick_dimensions(n):
    """Return (cols, win) for a vocabulary of n unique words, or (None, None)."""
    for min_words, cols, win in BOARD_TIERS:
        if n >= min_words:
            return cols, win
    return None, None


def build_board(words):
    """Sample words into a square board. Returns dict or None if too few words."""
    cols, win = pick_dimensions(len(words))
    if cols is None:
        return None
    count = cols * cols
    cells = random.sample(words, count)
    return {"cells": cells, "cols": cols, "win": win}


def check_win(owners, cols, need, player):
    """True if `player` has `need` of their cells in a row (any direction)."""
    n = cols

    def at(r, c):
        return owners[r * n + c]

    dirs = [(0, 1), (1, 0), (1, 1), (1, -1)]
    for r in range(n):
        for c in range(n):
            if at(r, c) != player:
                continue
            for dr, dc in dirs:
                cnt = 0
                rr, cc = r, c
                while 0 <= rr < n and 0 <= cc < n and at(rr, cc) == player:
                    cnt += 1
                    if cnt >= need:
                        return True
                    rr += dr
                    cc += dc
    return False


# ====== Room state (in-memory) ======
rooms = {}
rooms_lock = threading.Lock()


def gen_code():
    chars = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(chars, k=4))
        if code not in rooms:
            return code


def room_player_count(room):
    return len(room["players"])


def find_room_by_sid(sid):
    for code, room in rooms.items():
        if sid in room["players"]:
            return code, room
    return None, None


# ====== HTTP routes ======
@app.route("/")
def index():
    return render_template("menu.html")


@app.route("/game")
def game():
    # Local (same-device) hot-seat game — unchanged.
    return render_template("game.html")


@app.route("/online")
def online():
    return render_template("online.html")


@app.route("/get_words")
def get_words():
    # Used by the local game: 100 unique random words.
    words = random.sample(HSK_WORDS, 100)
    return jsonify({"words": words})


# ====== Realtime: rooms & gameplay ======
@socketio.on("create_room")
def on_create_room(data):
    raw = (data or {}).get("words", "")
    custom = clean_words(raw)

    if raw.strip() and len(custom) < MIN_WORDS:
        emit("error_msg", {"message": f"Need at least {MIN_WORDS} words. You provided {len(custom)}."})
        return

    pool = custom if len(custom) >= MIN_WORDS else list(HSK_WORDS)

    with rooms_lock:
        code = gen_code()
        rooms[code] = {
            "code": code,
            "pool": pool,
            "custom": bool(custom and len(custom) >= MIN_WORDS),
            "board": None,
            "owners": [],
            "players": {request.sid: 1},
            "host_sid": request.sid,
            "turn": 1,
            "started": False,
            "over": False,
            "winner": None,
        }

    join_room(code)
    emit("room_joined", {
        "code": code,
        "you": 1,
        "players": 1,
        "custom": rooms[code]["custom"],
        "poolSize": len(pool),
    })


@socketio.on("join_room")
def on_join_room(data):
    code = ((data or {}).get("code") or "").strip().upper()
    room = rooms.get(code)
    if not room:
        emit("error_msg", {"message": f"Room {code or '?'} not found."})
        return
    if request.sid in room["players"]:
        return
    if room_player_count(room) >= 2:
        emit("error_msg", {"message": "That room is already full."})
        return

    room["players"][request.sid] = 2
    join_room(code)

    emit("room_joined", {
        "code": code,
        "you": 2,
        "players": 2,
        "custom": room["custom"],
        "poolSize": len(room["pool"]),
    })
    # Tell everyone (both players) that the room now has 2 people.
    emit("peer_update", {"players": 2}, to=code)


@socketio.on("start_game")
def on_start_game(data):
    code = ((data or {}).get("code") or "").strip().upper()
    room = rooms.get(code)
    if not room:
        emit("error_msg", {"message": "Room not found."})
        return
    if request.sid != room["host_sid"]:
        emit("error_msg", {"message": "Only the host can start the game."})
        return
    if room_player_count(room) < 2:
        emit("error_msg", {"message": "Waiting for a second player."})
        return

    board = build_board(room["pool"])
    if not board:
        emit("error_msg", {"message": "Not enough words to build a board."})
        return

    room["board"] = board
    room["owners"] = [0] * (board["cols"] * board["cols"])
    room["turn"] = 1
    room["started"] = True
    room["over"] = False
    room["winner"] = None

    emit("game_started", {"board": board, "turn": 1}, to=code)


@socketio.on("claim_cell")
def on_claim_cell(data):
    code = ((data or {}).get("code") or "").strip().upper()
    index = (data or {}).get("index")
    room = rooms.get(code)
    if not room or not room["started"] or room["over"]:
        return

    player = room["players"].get(request.sid)
    if player is None or player != room["turn"]:
        return  # not your turn

    if not isinstance(index, int) or index < 0 or index >= len(room["owners"]):
        return
    if room["owners"][index] != 0:
        return  # already taken

    room["owners"][index] = player
    board = room["board"]

    if check_win(room["owners"], board["cols"], board["win"], player):
        room["over"] = True
        room["winner"] = player
        emit("cell_claimed", {"index": index, "owner": player, "turn": player}, to=code)
        emit("game_over", {"winner": player}, to=code)
        return

    room["turn"] = 2 if player == 1 else 1
    emit("cell_claimed", {"index": index, "owner": player, "turn": room["turn"]}, to=code)


@socketio.on("pass_turn")
def on_pass_turn(data):
    code = ((data or {}).get("code") or "").strip().upper()
    room = rooms.get(code)
    if not room or not room["started"] or room["over"]:
        return
    player = room["players"].get(request.sid)
    if player is None or player != room["turn"]:
        return
    room["turn"] = 2 if player == 1 else 1
    emit("turn_changed", {"turn": room["turn"]}, to=code)


@socketio.on("play_again")
def on_play_again(data):
    code = ((data or {}).get("code") or "").strip().upper()
    room = rooms.get(code)
    if not room:
        return
    if request.sid != room["host_sid"]:
        emit("error_msg", {"message": "Only the host can start a new match."})
        return
    if room_player_count(room) < 2:
        emit("error_msg", {"message": "Waiting for the other player to rejoin."})
        return

    board = build_board(room["pool"])
    if not board:
        return
    room["board"] = board
    room["owners"] = [0] * (board["cols"] * board["cols"])
    room["turn"] = 1
    room["started"] = True
    room["over"] = False
    room["winner"] = None
    emit("game_started", {"board": board, "turn": 1}, to=code)


@socketio.on("disconnect")
def on_disconnect():
    code, room = find_room_by_sid(request.sid)
    if not room:
        return
    was_host = request.sid == room["host_sid"]
    del room["players"][request.sid]
    leave_room(code)

    if room_player_count(room) == 0:
        with rooms_lock:
            rooms.pop(code, None)
        return

    # Someone is still here — tell them the opponent left and stop the match.
    room["started"] = False
    room["over"] = True
    emit("opponent_left", {"wasHost": was_host}, to=code)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
