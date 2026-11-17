(() => {
  const columns = 5;
  const rows = 4;
  const pieceCount = columns * rows;
  const image = new Image();

  const board = document.querySelector("#board");
  const tray = document.querySelector("#piece-tray");
  const progress = document.querySelector("#progress");
  const message = document.querySelector("#game-message");
  const restartButton = document.querySelector("#restart-button");
  const previewButton = document.querySelector("#preview-button");
  const musicButton = document.querySelector("#music-button");
  const backgroundMusic = document.querySelector("#background-music");
  const boardGuide = document.querySelector("#board-guide");

  let pieces = [];
  let placedCount = 0;
  let dragging = null;
  let resizeTimer = 0;
  let generation = 0;
  let cellWidth = 0;
  let cellHeight = 0;
  let tabSize = 0;
  let horizontalEdges = [];
  let verticalEdges = [];
  let audioContext = null;
  let audioUnavailableReported = false;
  let musicBlockedByAutoplay = false;

  function shuffle(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }

  function pointAlong(startX, startY, directionX, directionY, length, normalX, normalY, t, offset) {
    const distance = length * t;
    return [
      startX + directionX * distance + normalX * offset * tabSize,
      startY + directionY * distance + normalY * offset * tabSize
    ];
  }

  function curveCommand(points) {
    return `C ${points.map((point) => point.join(" ")).join(" ")}`;
  }

  function appendEdge(path, startX, startY, directionX, directionY, length, normalX, normalY, type) {
    const endX = startX + directionX * length;
    const endY = startY + directionY * length;

    if (type === 0) {
      return `${path} L ${endX} ${endY}`;
    }

    const point = (t, offset) =>
      pointAlong(startX, startY, directionX, directionY, length, normalX, normalY, t, offset * type);
    const curves = [
      [point(0.39, 0), point(0.39, 0.72), point(0.43, 0.72)],
      [point(0.48, 0.72), point(0.46, 1.05), point(0.5, 1.05)],
      [point(0.54, 1.05), point(0.52, 0.72), point(0.57, 0.72)],
      [point(0.61, 0.72), point(0.61, 0), point(0.68, 0)]
    ];

    path += ` L ${point(0.32, 0).join(" ")}`;
    for (const curve of curves) {
      path += ` ${curveCommand(curve)}`;
    }
    return `${path} L ${endX} ${endY}`;
  }

  function createPiecePath(row, column, horizontalEdges, verticalEdges) {
    let path = "M 0 0";
    path = appendEdge(
      path, 0, 0, 1, 0, cellWidth, 0, -1,
      row === 0 ? 0 : -horizontalEdges[row - 1][column]
    );
    path = appendEdge(
      path, cellWidth, 0, 0, 1, cellHeight, 1, 0,
      column === columns - 1 ? 0 : verticalEdges[row][column]
    );
    path = appendEdge(
      path, cellWidth, cellHeight, -1, 0, cellWidth, 0, 1,
      row === rows - 1 ? 0 : horizontalEdges[row][column]
    );
    path = appendEdge(
      path, 0, cellHeight, 0, -1, cellHeight, -1, 0,
      column === 0 ? 0 : -verticalEdges[row][column - 1]
    );
    return `${path} Z`;
  }

  function makeSvgPiece(index, row, column, horizontalEdges, verticalEdges) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    const width = cellWidth + tabSize * 2;
    const height = cellHeight + tabSize * 2;
    const shapeId = `piece-shape-${generation}-${index}`;
    const defs = document.createElementNS(svgNamespace, "defs");
    const clipPath = document.createElementNS(svgNamespace, "clipPath");
    const clipShape = document.createElementNS(svgNamespace, "path");
    const photo = document.createElementNS(svgNamespace, "image");
    const outline = document.createElementNS(svgNamespace, "path");
    const shape = createPiecePath(row, column, horizontalEdges, verticalEdges);

    svg.setAttribute("class", "piece");
    svg.setAttribute("viewBox", `${-tabSize} ${-tabSize} ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `ชิ้นส่วนที่ ${index + 1}`);
    svg.setAttribute("tabindex", "0");
    svg.dataset.index = String(index);

    clipPath.setAttribute("id", shapeId);
    clipShape.setAttribute("d", shape);
    clipPath.append(clipShape);
    defs.append(clipPath);

    photo.setAttribute("href", image.src);
    photo.setAttribute("x", String(-column * cellWidth));
    photo.setAttribute("y", String(-row * cellHeight));
    photo.setAttribute("width", String(cellWidth * columns));
    photo.setAttribute("height", String(cellHeight * rows));
    photo.setAttribute("preserveAspectRatio", "none");
    photo.setAttribute("clip-path", `url(#${shapeId})`);

    outline.setAttribute("d", shape);
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "#f4f7f5");
    outline.setAttribute("stroke-opacity", "0.68");
    outline.setAttribute("stroke-width", "1.5");
    outline.setAttribute("stroke-linejoin", "round");

    svg.append(defs, photo, outline);
    return svg;
  }

  function updateProgress() {
    progress.textContent = `วางแล้ว ${placedCount} / ${pieceCount} ชิ้น`;
  }

  function playSound(notes) {
    if (!window.AudioContext) {
      if (!audioUnavailableReported) {
        console.warn("Web Audio API is not supported; puzzle sound effects are disabled.");
        audioUnavailableReported = true;
      }
      return;
    }

    if (!audioContext) {
      audioContext = new AudioContext();
    }

    const scheduleNotes = () => {
      for (const note of notes) {
        const startTime = audioContext.currentTime + (note.delay || 0);
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.frequency, startTime);
        oscillator.frequency.linearRampToValueAtTime(note.endFrequency, startTime + note.duration);
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(note.volume, startTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + note.duration);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.addEventListener("ended", () => {
          oscillator.disconnect();
          gain.disconnect();
        }, { once: true });
        oscillator.start(startTime);
        oscillator.stop(startTime + note.duration);
      }
    };

    if (audioContext.state === "suspended") {
      audioContext.resume().then(scheduleNotes).catch((error) => {
        console.error("Unable to resume audio for puzzle sound effects.", error);
      });
    } else if (audioContext.state === "running") {
      scheduleNotes();
    }
  }

  function playPickupSound() {
    playSound([
      { frequency: 760, endFrequency: 520, duration: 0.13, type: "triangle", volume: 0.14 }
    ]);
  }

  function playPlaceSound() {
    playSound([
      { frequency: 660, endFrequency: 990, duration: 0.17, type: "sine", volume: 0.16 },
      { frequency: 990, endFrequency: 1320, duration: 0.19, type: "triangle", volume: 0.08, delay: 0.045 }
    ]);
  }

  function playReturnSound() {
    playSound([
      { frequency: 360, endFrequency: 220, duration: 0.15, type: "triangle", volume: 0.11 }
    ]);
  }

  function updateMusicButton() {
    const isPlaying = !backgroundMusic.paused && !backgroundMusic.ended;
    musicButton.textContent = isPlaying ? "ปิดเพลงพื้นหลัง" : "เปิดเพลงพื้นหลัง";
    musicButton.setAttribute("aria-pressed", String(isPlaying));
    musicButton.title = isPlaying ? "ปิดเพลงพื้นหลัง" : "เปิดเพลงพื้นหลัง";
  }

  function handleMusicPlaybackError(error) {
    if (error.name === "NotAllowedError") {
      musicBlockedByAutoplay = true;
      updateMusicButton();
      musicButton.title = "Browser บล็อกการเล่นอัตโนมัติ คลิกเพื่อเปิดเพลง";
      return;
    }

    musicButton.disabled = true;
    musicButton.textContent = "เพลงไม่พร้อมใช้งาน";
    console.error("Unable to play themesong.mp3.", error);
  }

  function playBackgroundMusic() {
    musicBlockedByAutoplay = false;
    const playback = backgroundMusic.play();
    if (playback && typeof playback.then === "function") {
      playback.then(updateMusicButton).catch(handleMusicPlaybackError);
    }
  }

  function startGame(preservePlacement) {
    const previouslyPlaced = preservePlacement
      ? new Set(pieces.filter((piece) => piece.placed).map((piece) => Number(piece.dataset.index)))
      : new Set();
    const boardRect = board.getBoundingClientRect();

    if (!boardRect.width) {
      return;
    }

    generation += 1;
    cellWidth = boardRect.width / columns;
    cellHeight = boardRect.height / rows;
    tabSize = Math.min(cellWidth, cellHeight) * 0.18;
    tray.style.setProperty("--piece-width", `${cellWidth + tabSize * 2}px`);

    if (!preservePlacement) {
      horizontalEdges = Array.from({ length: rows - 1 }, () =>
        Array.from({ length: columns }, () => (Math.random() < 0.5 ? -1 : 1))
      );
      verticalEdges = Array.from({ length: rows }, () =>
        Array.from({ length: columns - 1 }, () => (Math.random() < 0.5 ? -1 : 1))
      );
    }
    const available = [];

    board.querySelectorAll(".piece").forEach((piece) => piece.remove());
    tray.replaceChildren();
    pieces = [];
    placedCount = previouslyPlaced.size;
    message.textContent = "";

    for (let index = 0; index < pieceCount; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const piece = makeSvgPiece(index, row, column, horizontalEdges, verticalEdges);
      const isPlaced = previouslyPlaced.has(index);
      piece.placed = isPlaced;
      pieces.push(piece);

      if (isPlaced) {
        piece.style.position = "absolute";
        piece.style.left = `${column * cellWidth - tabSize}px`;
        piece.style.top = `${row * cellHeight - tabSize}px`;
        board.append(piece);
      } else {
        available.push(piece);
      }
    }

    shuffle(available).forEach((piece) => tray.append(piece));
    fitTrayPieces();
    updateProgress();
  }

  function fitTrayPieces() {
    if (!window.matchMedia("(min-width: 1100px) and (min-height: 600px)").matches) {
      tray.style.removeProperty("--tray-piece-width");
      tray.style.removeProperty("--tray-piece-height");
      return;
    }

    const styles = getComputedStyle(tray);
    const columnWidth = parseFloat(styles.gridTemplateColumns.split(" ")[0]);
    const rowHeight = parseFloat(styles.gridTemplateRows.split(" ")[0]);
    const columnGap = parseFloat(styles.columnGap);
    const rowGap = parseFloat(styles.rowGap);
    const availableWidth = columnWidth - columnGap;
    const availableHeight = rowHeight - rowGap;
    const samplePiece = pieces[0];
    const fullWidth = Number(samplePiece.getAttribute("width"));
    const fullHeight = Number(samplePiece.getAttribute("height"));
    const scale = Math.min(1, availableWidth / fullWidth, availableHeight / fullHeight);

    tray.style.setProperty("--tray-piece-width", `${fullWidth * scale}px`);
    tray.style.setProperty("--tray-piece-height", `${fullHeight * scale}px`);
  }

  function beginDrag(event, piece) {
    if (piece.placed || event.button !== 0) {
      return;
    }

    event.preventDefault();
    playPickupSound();
    const rect = piece.getBoundingClientRect();
    const fullWidth = Number(piece.getAttribute("width"));
    const fullHeight = Number(piece.getAttribute("height"));
    const scaleX = fullWidth / rect.width;
    const scaleY = fullHeight / rect.height;
    dragging = {
      piece,
      offsetX: (event.clientX - rect.left) * scaleX,
      offsetY: (event.clientY - rect.top) * scaleY
    };
    piece.classList.add("dragging");
    piece.style.position = "fixed";
    piece.style.left = `${event.clientX - dragging.offsetX}px`;
    piece.style.top = `${event.clientY - dragging.offsetY}px`;
    piece.style.width = `${fullWidth}px`;
    piece.style.height = `${fullHeight}px`;
    document.body.append(piece);
  }

  function moveDrag(event) {
    if (!dragging) {
      return;
    }
    dragging.piece.style.left = `${event.clientX - dragging.offsetX}px`;
    dragging.piece.style.top = `${event.clientY - dragging.offsetY}px`;
  }

  function endDrag() {
    if (!dragging) {
      return;
    }

    const { piece } = dragging;
    const pieceRect = piece.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const column = Math.round((pieceRect.left + tabSize - boardRect.left) / cellWidth);
    const row = Math.round((pieceRect.top + tabSize - boardRect.top) / cellHeight);
    const columnError = Math.abs(pieceRect.left + tabSize - boardRect.left - column * cellWidth);
    const rowError = Math.abs(pieceRect.top + tabSize - boardRect.top - row * cellHeight);
    const index = Number(piece.dataset.index);
    const targetOccupied = pieces.some(
      (otherPiece) => otherPiece.placed && Number(otherPiece.dataset.index) === row * columns + column
    );
    const isInsideBoard = column >= 0 && column < columns && row >= 0 && row < rows;
    const isCorrectPosition =
      isInsideBoard &&
      row * columns + column === index &&
      columnError <= cellWidth * 0.32 &&
      rowError <= cellHeight * 0.32;

    piece.classList.remove("dragging");
    piece.style.removeProperty("position");
    piece.style.removeProperty("left");
    piece.style.removeProperty("top");
    piece.style.removeProperty("width");
    piece.style.removeProperty("height");

    if (isCorrectPosition && !targetOccupied) {
      playPlaceSound();
      piece.placed = true;
      piece.style.position = "absolute";
      piece.style.left = `${column * cellWidth - tabSize}px`;
      piece.style.top = `${row * cellHeight - tabSize}px`;
      board.append(piece);
      placedCount += 1;
      updateProgress();

      if (placedCount === pieceCount) {
        message.textContent = "ยอดเยี่ยม! ต่อภาพสำเร็จแล้ว";
      }
    } else {
      playReturnSound();
      tray.append(piece);
    }

    dragging = null;
  }

  image.addEventListener("load", () => {
    board.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    boardGuide.src = image.src;
    startGame(false);
    restartButton.disabled = false;
    previewButton.disabled = false;
  });

  image.addEventListener("error", () => {
    progress.textContent = "โหลด car.jpg ไม่สำเร็จ";
    message.textContent = "ตรวจสอบว่าไฟล์ car.jpg อยู่ในโฟลเดอร์เดียวกับ index.html";
  });

  tray.addEventListener("pointerdown", (event) => {
    const piece = event.target.closest(".piece");
    if (piece) {
      beginDrag(event, piece);
    }
  });
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  restartButton.addEventListener("click", () => startGame(false));
  musicButton.addEventListener("click", () => {
    if (backgroundMusic.paused) {
      playBackgroundMusic();
    } else {
      backgroundMusic.pause();
    }
  });
  backgroundMusic.addEventListener("play", updateMusicButton);
  backgroundMusic.addEventListener("pause", updateMusicButton);
  backgroundMusic.addEventListener("error", () => {
    musicButton.disabled = true;
    musicButton.textContent = "เพลงไม่พร้อมใช้งาน";
    console.error("Unable to load themesong.mp3.", backgroundMusic.error);
  });
  document.addEventListener("pointerdown", (event) => {
    if (musicBlockedByAutoplay && !musicButton.contains(event.target)) {
      playBackgroundMusic();
    }
  });
  previewButton.addEventListener("click", () => {
    const previewing = board.classList.toggle("previewing");
    previewButton.textContent = previewing ? "ซ่อนภาพตัวอย่าง" : "ดูภาพตัวอย่าง";
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!dragging && image.complete && image.naturalWidth) {
        startGame(true);
      }
    }, 180);
  });

  backgroundMusic.volume = 0.22;
  updateMusicButton();
  playBackgroundMusic();
  image.src = "car.jpg";
})();
