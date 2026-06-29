// ====== Mandarena Online (room-based PvP) ======

// ---- Connection ----
const socket = io();

// ---- Game state ----
let me = 0;            // 1 or 2 (which player I am)
let roomCode = "";
let isHost = false;
let turn = 0;          // whose turn it is (1 or 2)
let started = false;
let over = false;

let cols = 10;
let winLen = 5;

// Per-turn control (only meaningful on my own turn)
const MAX_ATTEMPTS_PER_CELL = 3;
const MAX_CELLS_PER_TURN = 2;
let failedCellsThisTurn = 0;

// Modal attempt state
let attemptsForCell = 0;
let activeCell = null;
let modalCountdown = null;
let isModalTimerRunning = false;

// ---- Sounds ----
const clickSound   = new Audio(AUDIO_CLICK);
const bingoSound   = new Audio(AUDIO_BINGO);
const errorSound   = new Audio(AUDIO_ERROR);
const winnerSound  = new Audio(AUDIO_WINNER);
const markingSound = new Audio(AUDIO_MARKING);
const tiktokSound  = new Audio(AUDIO_TIKTOK);
tiktokSound.loop = true;

// ---- DOM: lobby ----
const lobbyEl     = document.getElementById("lobby");
const waitingEl   = document.getElementById("waiting");
const gameAreaEl  = document.getElementById("gameArea");

const vocabInput  = document.getElementById("vocabInput");
const vocabCount  = document.getElementById("vocabCount");
const createBtn   = document.getElementById("createBtn");
const codeInput   = document.getElementById("codeInput");
const joinBtn     = document.getElementById("joinBtn");
const lobbyError  = document.getElementById("lobbyError");

const roomCodeEl  = document.getElementById("roomCode");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const dotP1       = document.getElementById("dotP1");
const dotP2       = document.getElementById("dotP2");
const waitingMsg  = document.getElementById("waitingMsg");
const boardInfoEl = document.getElementById("boardInfo");
const startBtn    = document.getElementById("startBtn");
const youAreEl    = document.getElementById("youAre");

// ---- DOM: game ----
const boardEl       = document.getElementById("board");
const instructionEl = document.getElementById("instruction");
const speechModal   = document.getElementById("speechModal");
const modalTimerEl  = document.getElementById("modalTimer");
const attemptTextEl = document.getElementById("attemptText");
const modalWordEl   = document.getElementById("modalWord");
const modalResultEl = document.getElementById("modalResult");
const speakBtn      = document.getElementById("speakBtn");
const winnerOverlay = document.getElementById("winnerOverlay");
const winnerTextEl  = document.getElementById("winnerText");
const againBtn      = document.getElementById("againBtn");

// ====== Warn before leaving an active game ======
window.addEventListener("beforeunload", (e) => {
  if (started && !over) {
    e.preventDefault();
    e.returnValue = "Leaving will drop you from the online match!";
    return e.returnValue;
  }
});

// ====== Lobby actions ======
function countWords(raw) {
  const parts = (raw || "").split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean);
  return new Set(parts).size;
}

vocabInput.addEventListener("input", () => {
  const n = countWords(vocabInput.value);
  vocabCount.textContent = n === 0 ? "0 words (will use default HSK 1 list)" : `${n} unique words`;
});

// ---- "Use random" level buttons: fill the textarea from the leveled word bank ----
const levelHint = document.getElementById("levelHint");

(function loadBankInfo() {
  fetch("/wordbank_info")
    .then(r => r.json())
    .then(info => {
      const c = info.counts || {};
      levelHint.textContent =
        `L1 HSK 1–2 (${c["1"]||0}) · L2 HSK 3–4 (${c["2"]||0}) · ` +
        `L3 HSK 5–6 (${c["3"]||0}) · L4 HSK 7–9 (${c["4"]||0}) — ${info.total||0} words total`;
    })
    .catch(() => {});
})();

document.querySelectorAll(".lvl").forEach(btn => {
  btn.addEventListener("click", () => {
    const level = btn.dataset.level;
    clickSound.currentTime = 0; clickSound.play().catch(()=>{});
    btn.disabled = true;
    fetch(`/random_words?level=${encodeURIComponent(level)}&n=100`)
      .then(r => r.json())
      .then(data => {
        if (!data.words || !data.words.length) {
          lobbyError.textContent = "Could not load words for that level.";
          return;
        }
        vocabInput.value = data.words.join("\n");
        vocabInput.dispatchEvent(new Event("input"));
        vocabCount.textContent = `${data.words.length} random words — ${data.label}`;
        lobbyError.textContent = "";
      })
      .catch(() => { lobbyError.textContent = "Could not reach the word bank."; })
      .finally(() => { btn.disabled = false; });
  });
});

createBtn.addEventListener("click", () => {
  clickSound.currentTime = 0; clickSound.play().catch(()=>{});
  lobbyError.textContent = "";
  socket.emit("create_room", { words: vocabInput.value });
});

joinBtn.addEventListener("click", () => {
  const code = (codeInput.value || "").trim().toUpperCase();
  if (!code) { lobbyError.textContent = "Enter a room code first."; return; }
  clickSound.currentTime = 0; clickSound.play().catch(()=>{});
  lobbyError.textContent = "";
  socket.emit("join_room", { code });
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase();
});

copyLinkBtn.addEventListener("click", () => {
  const link = `${location.origin}/online?room=${roomCode}`;
  navigator.clipboard.writeText(link).then(() => {
    copyLinkBtn.textContent = "COPIED!";
    setTimeout(() => (copyLinkBtn.textContent = "COPY INVITE LINK"), 1500);
  }).catch(() => {
    copyLinkBtn.textContent = roomCode;
  });
});

startBtn.addEventListener("click", () => {
  if (startBtn.disabled) return;
  clickSound.currentTime = 0; clickSound.play().catch(()=>{});
  socket.emit("start_game", { code: roomCode });
});

againBtn.addEventListener("click", () => {
  socket.emit("play_again", { code: roomCode });
});

// ---- Microphone helper / quick permission access ----
const testMicBtn = document.getElementById("testMicBtn");
const micStatus  = document.getElementById("micStatus");
const macMicLink = document.getElementById("macMicLink");

const isMac    = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

// The macOS settings quick link only makes sense on a Mac.
if (!isMac && macMicLink) macMicLink.style.display = "none";

// Gentle nudge: Safari's speech recognition is unreliable for this game.
if (isSafari && micStatus) {
  micStatus.innerHTML = "⚠️ Safari's speech recognition is unreliable here — <strong>Google Chrome</strong> works best.";
  micStatus.className = "mic-status warn";
}

if (testMicBtn) {
  testMicBtn.addEventListener("click", async () => {
    micStatus.className = "mic-status";
    micStatus.textContent = "Requesting microphone…";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micStatus.textContent = "This browser can't access the mic. Try Google Chrome.";
      micStatus.className = "mic-status err";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());  // we only needed the prompt/permission
      micStatus.textContent = "✅ Microphone enabled — you're good to go!";
      micStatus.className = "mic-status ok";
    } catch (err) {
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        micStatus.innerHTML = isMac
          ? "🚫 Mic blocked. Use <strong>Open macOS mic settings</strong> above to allow it, then reload."
          : "🚫 Mic blocked. Allow it via the lock / 🎤 icon in the address bar, then reload.";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        micStatus.textContent = "🚫 No microphone found on this device.";
      } else {
        micStatus.textContent = "Couldn't access the mic. Open the help below.";
      }
      micStatus.className = "mic-status err";
    }
  });
}

// Prefill code from ?room=XXXX so an invite link drops you straight in.
(function prefillRoom() {
  const params = new URLSearchParams(location.search);
  const r = params.get("room");
  if (r) codeInput.value = r.toUpperCase();
})();

// ====== Socket events ======
socket.on("connect_error", () => {
  lobbyError.textContent = "Could not connect to the server.";
});

socket.on("error_msg", (data) => {
  const msg = (data && data.message) || "Something went wrong.";
  if (!lobbyEl.classList.contains("hidden")) {
    lobbyError.textContent = msg;
  } else {
    waitingMsg.textContent = msg;
  }
});

socket.on("room_joined", (data) => {
  me = data.you;
  roomCode = data.code;
  isHost = (me === 1);

  lobbyEl.classList.add("hidden");
  waitingEl.classList.remove("hidden");

  roomCodeEl.textContent = roomCode;
  youAreEl.innerHTML = `You are <strong class="${me === 1 ? 'p1-text' : 'p2-text'}">Player ${me}</strong>`;
  boardInfoEl.textContent = data.custom
    ? `Custom word list (${data.poolSize} words).`
    : `Default HSK 1 list (${data.poolSize} words).`;

  updateWaitingRoom(data.players);
});

socket.on("peer_update", (data) => {
  updateWaitingRoom(data.players);
});

socket.on("game_started", (data) => {
  startGame(data.board, data.turn);
});

socket.on("cell_claimed", (data) => {
  applyClaim(data.index, data.owner);
  if (!over) setTurn(data.turn);
});

socket.on("turn_changed", (data) => {
  setTurn(data.turn);
});

socket.on("game_over", (data) => {
  onGameOver(data.winner);
});

socket.on("opponent_left", () => {
  started = false;
  over = true;
  closeSpeechModal();
  winnerOverlay.classList.add("hidden");
  alert("Your opponent left the game.");
  // Back to the lobby for a fresh start.
  gameAreaEl.classList.add("hidden");
  waitingEl.classList.add("hidden");
  lobbyEl.classList.remove("hidden");
  lobbyError.textContent = "Opponent disconnected. Create or join a new room.";
});

// ====== Waiting room ======
function updateWaitingRoom(players) {
  if (players >= 2) {
    dotP2.classList.remove("off");
    dotP2.textContent = "P2 ⬤";
    waitingMsg.textContent = "Both players here!";
    if (isHost) {
      startBtn.disabled = false;
      startBtn.textContent = "START GAME";
    } else {
      startBtn.classList.add("hidden");
      waitingMsg.textContent = "Both players here! Waiting for host to start…";
    }
  } else {
    dotP2.classList.add("off");
    dotP2.textContent = "P2 ◯";
    waitingMsg.textContent = "Waiting for a second player…";
    if (isHost) {
      startBtn.disabled = true;
    } else {
      startBtn.classList.add("hidden");
    }
  }
}

// ====== Start / build ======
function startGame(board, firstTurn) {
  cols = board.cols;
  winLen = board.win;
  over = false;
  started = true;
  failedCellsThisTurn = 0;

  buildBoard(board.cells, cols);

  waitingEl.classList.add("hidden");
  lobbyEl.classList.add("hidden");
  gameAreaEl.classList.remove("hidden");
  winnerOverlay.classList.add("hidden");
  againBtn.classList.add("hidden");

  // Highlight which avatar is "me".
  document.getElementById("tagP1").textContent = me === 1 ? "P1 (You)" : "P1";
  document.getElementById("tagP2").textContent = me === 2 ? "P2 (You)" : "P2";

  setTurn(firstTurn);
}

function buildBoard(words, n) {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  boardEl.style.width = `min(96vw, ${n * 120}px)`;
  words.forEach((w, i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = String(i);
    cell.dataset.word = w;
    cell.dataset.owner = "0";
    cell.textContent = w;
    cell.addEventListener("click", () => onCellClick(cell));
    boardEl.appendChild(cell);
  });
}

// ====== Turn handling ======
function myTurn() {
  return started && !over && me === turn;
}

function setTurn(t) {
  turn = t;
  if (myTurn()) failedCellsThisTurn = 0;
  setBoardDisabled(!myTurn());
  if (over) return;
  if (myTurn()) {
    setInstruction("Your turn — pick a square!");
  } else {
    setInstruction(`Player ${turn}'s turn…`);
  }
}

function setBoardDisabled(disabled) {
  boardEl.classList.toggle("disabled", disabled);
  document.querySelectorAll(".cell").forEach(c => c.classList.toggle("disabled", disabled || c.dataset.owner !== "0"));
}

function setInstruction(html) {
  instructionEl.classList.remove("typewriter");
  void instructionEl.offsetWidth;
  instructionEl.innerHTML = html;
  instructionEl.classList.add("typewriter");
}

// ====== Board interaction ======
function onCellClick(cell) {
  if (!myTurn()) return;
  if (cell.dataset.owner !== "0") return;
  if (boardEl.classList.contains("disabled")) return;
  highlightCell(cell, true);
  openSpeechModal(cell);
}

function highlightCell(cell, on) {
  document.querySelectorAll(".cell.highlight").forEach(c => c.classList.remove("highlight", "modal-open"));
  if (on) cell.classList.add("highlight");
}

// ====== Modal flow ======
function openSpeechModal(cell) {
  activeCell = cell;
  attemptsForCell = 0;
  modalWordEl.textContent = cell.dataset.word || "";
  modalResultEl.textContent = "";
  attemptTextEl.textContent = `Attempt ${attemptsForCell + 1} / ${MAX_ATTEMPTS_PER_CELL}`;

  const tip = document.getElementById("modalInstruction");
  if ((cell.dataset.word || "").length === 1) {
    tip.style.display = "block";
    tip.style.whiteSpace = "pre-line";
    tip.textContent = "Tip: For single characters, try to\nstretch the end of the word longer!";
  } else {
    tip.style.display = "none";
  }

  setBoardDisabled(true);
  speechModal.classList.remove("hidden");
  cell.classList.add("modal-open");

  startModalCountdown(5, () => attemptFail("Time out. Try again."));

  speakBtn.disabled = false;
  speakBtn.onclick = () => {
    if (speakBtn.disabled) return;
    speakBtn.disabled = true;
    clickSound.currentTime = 0; clickSound.play().catch(()=>{});
    pauseModalCountdown();
    startSpeechRecognition(cell);
  };
}

function closeSpeechModal() {
  stopModalCountdown(true);
  speechModal.classList.add("hidden");
  if (activeCell) {
    activeCell.classList.remove("modal-open");
    highlightCell(activeCell, false);
  }
  const mc = speechModal.querySelector(".modal-content");
  if (mc) mc.classList.remove("shake");
  activeCell = null;
}

function attemptFail(msg) {
  errorSound.currentTime = 0; errorSound.play().catch(()=>{});
  modalResultEl.textContent = msg;

  const mc = speechModal.querySelector(".modal-content");
  mc.classList.remove("shake");
  void mc.offsetWidth;
  mc.classList.add("shake");

  attemptsForCell++;
  speakBtn.disabled = false;

  if (attemptsForCell < MAX_ATTEMPTS_PER_CELL) {
    attemptTextEl.textContent = `Attempt ${attemptsForCell + 1} / ${MAX_ATTEMPTS_PER_CELL}`;
    startModalCountdown(5, () => attemptFail("Time out. Try again."));
  } else {
    closeSpeechModal();
    failedCellsThisTurn++;
    if (failedCellsThisTurn >= MAX_CELLS_PER_TURN) {
      // Out of tries this turn — hand over to the opponent.
      socket.emit("pass_turn", { code: roomCode });
      setBoardDisabled(true);
      setInstruction("Out of tries — passing turn…");
    } else {
      setBoardDisabled(false);
      setInstruction(`Your turn — one more square (${MAX_CELLS_PER_TURN - failedCellsThisTurn} left).`);
    }
  }
}

function attemptSuccess(cell) {
  bingoSound.currentTime = 0; bingoSound.play().catch(()=>{});
  closeSpeechModal();
  // Tell the server; the authoritative result comes back via "cell_claimed".
  const index = parseInt(cell.dataset.index, 10);
  socket.emit("claim_cell", { code: roomCode, index });
  setBoardDisabled(true);
  setInstruction("Marking…");
}

// ====== Apply a claim broadcast from the server ======
function applyClaim(index, owner) {
  const cell = boardEl.querySelector(`.cell[data-index="${index}"]`);
  if (!cell) return;
  cell.dataset.owner = String(owner);
  cell.classList.add("disabled");
  animateMark(cell, owner);
  markingSound.currentTime = 0; markingSound.play().catch(()=>{});
}

// ====== Speech recognition ======
function gatherCandidates(event) {
  const out = [];
  for (let i = 0; i < event.results.length; i++) {
    const r = event.results[i];
    for (let j = 0; j < r.length; j++) out.push((r[j].transcript || "").trim());
  }
  return out.filter(Boolean);
}

// Ask the server if any candidate sounds like the target (toneless pinyin).
function serverMatch(target, candidates) {
  return fetch("/match_speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, candidates })
  }).then(r => r.json()).then(d => !!d.match).catch(() => false);
}

function startSpeechRecognition(cell) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Speech recognition isn't supported in this browser. Please use Google Chrome.");
    resumeModalCountdown();
    speakBtn.disabled = false;
    return;
  }

  const target = (cell.dataset.word || "").trim();
  const rec = new SR();
  rec.lang = "zh-CN";
  rec.interimResults = true;   // capture short single-syllable words without dragging
  rec.continuous = false;
  rec.maxAlternatives = 8;

  let finished = false;
  let lastCandidates = [];

  function done(success, failMsg) {
    if (finished) return;
    finished = true;
    try { rec.stop(); } catch (e) {}
    if (success) {
      modalResultEl.textContent = "✔ Correct!";
      setTimeout(() => attemptSuccess(cell), 200);
    } else {
      modalResultEl.textContent = "✖ Not quite.";
      setTimeout(() => { resumeModalCountdown(); attemptFail(failMsg); }, 200);
    }
  }

  rec.onresult = (event) => {
    if (finished) return;
    const cands = gatherCandidates(event);
    if (cands.length) lastCandidates = cands;
    // Fast path: exact / substring match in the browser.
    if (cands.some(s => looseMatchChinese(s, target))) { done(true); return; }
    // On a final result, ask the server for a pinyin (homophone) match.
    if (Array.from(event.results).some(r => r.isFinal)) {
      serverMatch(target, cands).then(m => done(m, "Wrong. Try again."));
    }
  };

  rec.onerror = (e) => {
    const err = e && e.error;
    let msg = "Recognizer error. Try again.";
    if (err === "not-allowed" || err === "service-not-allowed")
      msg = "🎤 Mic blocked — click the lock/🎤 icon in the address bar and Allow.";
    else if (err === "no-speech")
      msg = "Didn't hear anything — try again.";
    else if (err === "aborted")
      msg = "Mic interrupted — click INTO this window first (only the active tab can use the mic).";
    else if (err === "audio-capture")
      msg = "No microphone found on this device.";
    else if (err === "network")
      msg = "Network issue with recognition — check your connection.";
    done(false, msg);
  };

  rec.onend = () => {
    if (finished) return;
    // Speech ended without an accepted match — check interim candidates by sound.
    if (lastCandidates.length) {
      serverMatch(target, lastCandidates).then(m => done(m, "Wrong. Try again."));
    } else if (!document.hasFocus()) {
      // Classic two-players-one-computer gotcha: background tabs can't use the mic.
      done(false, "Click INTO this window first — only the focused tab can use the mic.");
    } else {
      done(false, "No audio detected. Try again.");
    }
  };

  if (!document.hasFocus()) {
    modalResultEl.textContent = "Tip: click into this window so the mic can hear you.";
  }
  try { rec.start(); } catch (e) { done(false, "Could not start mic — is another tab using it?"); }
}

function looseMatchChinese(spoken, target) {
  const norm = s => s.replace(/[，。！？、,.!?]/g, "").replace(/\s+/g, "").trim();
  const s = norm(spoken);
  const t = norm(target);
  if (!s || !t) return false;
  if (s === t) return true;

  const similarMap = {
    "一": ["衣", "医"], "二": ["儿"], "三": ["散"], "四": ["死", "寺"],
    "十": ["石"], "七": ["气"], "八": ["吧"], "九": ["久"]
  };
  if (t.length === 1) {
    if (s.includes(t)) return true;
    if (similarMap[t] && similarMap[t].some(sim => s.includes(sim))) return true;
  }
  if (t.length <= 2 && s.includes(t)) return true;
  if (s.includes(t)) return true;
  return false;
}

// ====== Timers ======
function startModalCountdown(seconds, onEnd) {
  stopModalCountdown();
  let t = seconds;
  modalTimerEl.textContent = String(t);
  isModalTimerRunning = true;
  try { tiktokSound.currentTime = 0; tiktokSound.play().catch(()=>{}); } catch (e) {}
  modalCountdown = setInterval(() => {
    if (!isModalTimerRunning) return;
    t--;
    modalTimerEl.textContent = String(t);
    if (t <= 0) {
      stopModalCountdown(true);
      if (onEnd) onEnd();
    }
  }, 1000);
}
function pauseModalCountdown() {
  isModalTimerRunning = false;
  try { tiktokSound.pause(); } catch (e) {}
}
function resumeModalCountdown() {
  isModalTimerRunning = true;
  try { tiktokSound.play().catch(()=>{}); } catch (e) {}
}
function stopModalCountdown(stopSound = false) {
  clearInterval(modalCountdown);
  modalCountdown = null;
  isModalTimerRunning = false;
  if (stopSound) { try { tiktokSound.pause(); } catch (e) {} }
}

// ====== Win / overlay ======
function onGameOver(winner) {
  over = true;
  started = false;
  closeSpeechModal();
  setBoardDisabled(true);

  const youWon = (winner === me);
  winnerTextEl.textContent = youWon ? "You Win! 🎉" : `Player ${winner} Wins!`;
  winnerOverlay.classList.remove("hidden");
  winnerSound.currentTime = 0; winnerSound.play().catch(()=>{});

  if (youWon) {
    try { confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 } }); } catch (e) {}
  }

  // Host can launch a rematch with a freshly generated board.
  if (isHost) {
    againBtn.classList.remove("hidden");
  }
  setInstruction(youWon ? "You win!" : `Player ${winner} wins!`);
}

// ====== Mark animation ======
function animateMark(cell, player) {
  let layer = cell.querySelector(".mark-layer");
  if (!layer) {
    layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.setAttribute("class", "mark-layer");
    layer.setAttribute("viewBox", "0 0 100 100");
    layer.setAttribute("preserveAspectRatio", "none");
    cell.appendChild(layer);
  }
  while (layer.firstChild) layer.removeChild(layer.firstChild);

  const ns = "http://www.w3.org/2000/svg";
  const stroke = (player === 1)
    ? getComputedStyle(document.documentElement).getPropertyValue('--p1').trim()
    : getComputedStyle(document.documentElement).getPropertyValue('--p2').trim();

  let shape;
  if (player === 1) {
    shape = document.createElementNS(ns, "ellipse");
    shape.setAttribute("cx", "50"); shape.setAttribute("cy", "50");
    shape.setAttribute("rx", "44"); shape.setAttribute("ry", "34");
  } else {
    shape = document.createElementNS(ns, "rect");
    shape.setAttribute("x", "8"); shape.setAttribute("y", "16");
    shape.setAttribute("width", "84"); shape.setAttribute("height", "68");
    shape.setAttribute("rx", "12"); shape.setAttribute("ry", "12");
  }
  shape.setAttribute("fill", "transparent");
  shape.setAttribute("stroke", stroke || (player === 1 ? "#e84393" : "#0984e3"));
  shape.setAttribute("stroke-width", "6");
  shape.setAttribute("class", "mark-stroke crayon-stroke");
  layer.appendChild(shape);
}
