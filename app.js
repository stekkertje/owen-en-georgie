(() => {
  const PAGES = BOOK.pages;
  const HINTS = BOOK.hints;
  const VIDEOS = BOOK.videos;
  const SOUNDS = BOOK.sounds;
  const STORAGE = "owen-georgie-page";
  const AUTO_NEXT_MS = 1000;
  const UNLOCK_MS = 1000;

  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = (n) => String(n).padStart(2, "0");

  const state = {
    page: 0,
    dir: "next",
    narration: "idle",
    audioOk: typeof Audio !== "undefined",
    sceneActive: false,
    videoPlaying: false,
    audioRevealed: false,
    canScroll: false,
  };

  let narrationAudio = null;
  let interactionAudio = null;
  let autoChain = false;
  let endTimer = null;
  let pollTimer = null;
  let retryTimer = null;
  let revealTimer = null;
  let sceneTimer = null;
  let pointerStart = null;
  let sparkleId = 0;

  const root = document.getElementById("app");

  function stopNarration() {
    autoChain = false;
    if (endTimer) clearTimeout(endTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (retryTimer) clearTimeout(retryTimer);
    endTimer = pollTimer = retryTimer = null;
    if (narrationAudio) {
      narrationAudio.pause();
      narrationAudio.currentTime = 0;
    }
    narrationAudio = null;
    state.narration = "idle";
  }

  function goTo(next) {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
    if (clamped === state.page) return;
    state.dir = clamped > state.page ? "next" : "previous";
    stopNarration();
    const video = $("video.scene-video");
    if (video) video.pause();
    state.videoPlaying = false;
    state.sceneActive = false;
    state.page = clamped;
    localStorage.setItem(STORAGE, String(clamped));
    render();
    preloadNeighbors();
  }

  function preloadNeighbors() {
    const next = PAGES[state.page + 1];
    if (next) {
      const img = new Image();
      img.src = next.image;
    }
    if (next?.audio) new Audio(next.audio).preload = "auto";
    const sound = SOUNDS[state.page];
    if (sound) {
      interactionAudio = new Audio(sound.src);
      interactionAudio.preload = "auto";
      interactionAudio.volume = sound.volume;
    } else {
      interactionAudio = null;
    }
  }

  function playNarration(index, existing) {
    const src = PAGES[index]?.audio;
    if (!src) {
      autoChain = false;
      state.narration = "idle";
      updateAudioUi();
      return;
    }
    const audio = existing || new Audio(src);
    if (audio.getAttribute("src") !== src) {
      audio.src = src;
      audio.load();
    }
    audio.preload = "auto";
    audio.volume = 1;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (narrationAudio !== audio) return;
      if (autoChain && index < PAGES.length - 1) {
        state.narration = "idle";
        updateAudioUi();
        endTimer = setTimeout(() => {
          endTimer = null;
          if (!autoChain || narrationAudio !== audio) return;
          state.dir = "next";
          state.sceneActive = false;
          state.page = index + 1;
          localStorage.setItem(STORAGE, String(state.page));
          render();
          playNarration(index + 1, audio);
        }, AUTO_NEXT_MS);
      } else {
        narrationAudio = null;
        autoChain = false;
        state.narration = "idle";
        updateAudioUi();
      }
    };
    audio.onended = finish;
    audio.onerror = () => {
      if (narrationAudio === audio) {
        narrationAudio = null;
        autoChain = false;
        state.narration = "idle";
        updateAudioUi();
      }
    };
    narrationAudio = audio;
    const attempt = (left) => {
      audio
        .play()
        .then(() => {
          state.narration = "playing";
          updateAudioUi();
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = setInterval(() => {
            if (
              narrationAudio === audio &&
              Number.isFinite(audio.duration) &&
              audio.duration > 0 &&
              (audio.ended || audio.currentTime >= audio.duration - 0.05)
            ) {
              finish();
            }
          }, 500);
        })
        .catch(() => {
          if (narrationAudio !== audio || !autoChain) return;
          if (left > 0) {
            retryTimer = setTimeout(() => attempt(left - 1), 750);
            return;
          }
          narrationAudio = null;
          autoChain = false;
          state.narration = "idle";
          updateAudioUi();
        });
    };
    attempt(4);
  }

  function startNarration() {
    if (!state.audioOk) return;
    stopNarration();
    autoChain = true;
    playNarration(state.page);
  }

  function revealAudio() {
    if (revealTimer) clearTimeout(revealTimer);
    state.audioRevealed = true;
    $(".top-audio-controls")?.classList.add("is-revealed");
    revealTimer = setTimeout(() => {
      state.audioRevealed = false;
      $(".top-audio-controls")?.classList.remove("is-revealed");
    }, 2600);
  }

  function toggleNarration() {
    if (!state.audioOk) return;
    revealAudio();
    if (state.narration === "playing") {
      narrationAudio?.pause();
      state.narration = "paused";
      updateAudioUi();
      return;
    }
    if (state.narration === "paused") {
      if (!narrationAudio) {
        startNarration();
        return;
      }
      narrationAudio.play().then(() => {
        state.narration = "playing";
        updateAudioUi();
      });
      return;
    }
    startNarration();
  }

  function beginAdventure() {
    if (!state.audioOk) {
      goTo(1);
      return;
    }
    stopNarration();
    state.dir = "next";
    state.videoPlaying = false;
    state.sceneActive = false;
    state.page = 1;
    localStorage.setItem(STORAGE, "1");
    autoChain = true;
    const src = PAGES[1].audio;
    render();
    if (!src) return;
    const unlock = new Audio(src);
    unlock.preload = "auto";
    unlock.volume = 0;
    narrationAudio = unlock;
    const after = () => {
      unlock.pause();
      unlock.currentTime = 0;
      endTimer = setTimeout(() => {
        endTimer = null;
        if (autoChain && narrationAudio === unlock) playNarration(1, unlock);
      }, UNLOCK_MS);
    };
    unlock.play().then(after).catch(after);
  }

  function playInteraction() {
    const config = SOUNDS[state.page];
    if (!config) return;
    const sound = interactionAudio || new Audio(config.src);
    interactionAudio = sound;
    sound.pause();
    sound.currentTime = 0;
    sound.volume = config.volume;
    sound.play().catch(() => {});
  }

  function onInteract() {
    const hint = HINTS[state.page];
    if (!hint) return;
    playInteraction();
    const video = $("video.scene-video");
    if (VIDEOS[state.page] && video) {
      video.pause();
      video.currentTime = 0;
      state.videoPlaying = true;
      $("section.page")?.classList.add("is-video-playing");
      video.play().catch(() => {
        state.videoPlaying = false;
        $("section.page")?.classList.remove("is-video-playing");
      });
      return;
    }
    if (sceneTimer) clearTimeout(sceneTimer);
    const pageEl = $("section.page");
    pageEl?.classList.remove("is-scene-active");
    requestAnimationFrame(() => pageEl?.classList.add("is-scene-active"));
    sceneTimer = setTimeout(() => pageEl?.classList.remove("is-scene-active"), 6200);
  }

  function updateAudioUi() {
    const play = $(".narrate-button--top .narration-symbol");
    if (play) play.textContent = state.narration === "playing" ? "⏸️" : "▶️";
    root.classList.toggle("is-narrating", state.narration === "playing");
  }

  function navHtml() {
    const disabled = state.page === PAGES.length - 1 ? " disabled" : "";
    return `<nav class="page-nav" aria-label="Bladeren door het boek">
      <button class="nav-button nav-button--previous" type="button" data-go="-1" aria-label="Vorige pagina"><span aria-hidden="true">←</span></button>
      <button class="nav-button nav-button--next" type="button" data-go="1" aria-label="Volgende pagina"${disabled}><span aria-hidden="true">→</span></button>
    </nav>`;
  }

  function render() {
    const page = state.page;
    const current = PAGES[page];
    const isCover = page === 0;
    const isFinal = page === PAGES.length - 1;
    const hint = HINTS[page];
    const videoSrc = VIDEOS[page];
    const heading = isCover ? current.title : `${page}. ${current.title}`;

    root.className = `storybook is-ready${state.narration === "playing" ? " is-narrating" : ""}`;
    root.innerHTML = `
      <div class="sky" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <section class="page page--${state.dir} scene-${pad(page)}${isCover ? " page--cover" : ""}${isFinal ? " page--final" : ""}${hint ? " page--interactive" : ""}${state.sceneActive ? " is-scene-active" : ""}${state.videoPlaying ? " is-video-playing" : ""}"
        aria-live="polite"
        aria-label="${isCover ? `Omslag: ${current.title}` : `Pagina ${page} van ${PAGES.length - 1}: ${current.title}`}">
        <div class="artwork-wrap">
          <img class="artwork-backdrop" src="${current.image}" alt="" aria-hidden="true" draggable="false"/>
          <img class="artwork" src="${current.image}" alt="${current.alt}" draggable="false"/>
          <div class="artwork-shade" aria-hidden="true"></div>
          <div class="moon-glow" aria-hidden="true"></div>
          ${
            videoSrc
              ? `<video class="scene-video" src="${videoSrc}" muted playsinline preload="metadata" aria-hidden="true"></video>`
              : ""
          }
          ${
            hint
              ? `<button type="button" class="scene-interaction" aria-label="${hint}">
                  <span class="interaction-hint" aria-hidden="true"><span class="tap-star"><span class="tap-star-main">✧</span><span class="tap-star-small">✦</span><span class="tap-star-dot">•</span></span></span>
                  <span class="flying-ticket flying-ticket--one" aria-hidden="true">★</span>
                  <span class="flying-ticket flying-ticket--two" aria-hidden="true">★</span>
                </button>`
              : ""
          }
          ${!isCover ? navHtml().replace('class="page-nav"', 'class="page-nav artwork-nav"') : ""}
        </div>
        <article class="story-card">
          ${!isCover ? navHtml() : ""}
          <div class="story-copy">
            <h1>${heading}</h1>
            <p class="${isCover ? "cover-subtitle" : "story-text"}">${current.text.replace(/\n/g, "<br/>")}</p>
          </div>
          ${isCover ? `<button class="begin-button" type="button"><span>Begin het avontuur</span><span class="button-arrow" aria-hidden="true">→</span></button>` : ""}
          ${isFinal ? `<button class="end-restart" type="button">Lees nog een keer</button>` : ""}
        </article>
      </section>
      <header class="topbar" aria-label="Boekopties">
        ${
          !isCover
            ? `<button class="cover-button" type="button" data-home aria-label="Begin het verhaal opnieuw" title="Verhaal opnieuw beginnen"><span class="restart-arrow" aria-hidden="true">⏮️</span></button>
               <div class="page-status" aria-label="Voortgang: pagina ${page} van ${PAGES.length - 1}"><span>${page}/${PAGES.length - 1}</span></div>`
            : ""
        }
        ${
          !isCover && current.audio
            ? `<div class="top-audio-controls${state.audioRevealed ? " is-revealed" : ""}" aria-label="Voorleesbediening">
                <button type="button" class="icon-button replay-icon" data-replay aria-label="Lees deze pagina opnieuw voor" title="Opnieuw voorlezen">🔄</button>
                <button type="button" class="icon-button narrate-button--top" data-toggle aria-label="Lees deze pagina voor" title="Lees voor">
                  <span class="narration-symbol" aria-hidden="true">${state.narration === "playing" ? "⏸️" : "▶️"}</span>
                </button>
              </div>`
            : ""
        }
      </header>
      <div class="sparkle-layer" aria-hidden="true"></div>
    `;

    bind();
    preloadNeighbors();
  }

  function bind() {
    root.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        goTo(state.page + Number(btn.getAttribute("data-go")));
      });
    });
    $("[data-home]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(0);
    });
    $("[data-toggle]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNarration();
    });
    $("[data-replay]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      revealAudio();
      startNarration();
    });
    $(".begin-button")?.addEventListener("click", (e) => {
      e.stopPropagation();
      beginAdventure();
    });
    $(".end-restart")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(0);
    });
    $(".scene-interaction")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onInteract();
    });
    const video = $("video.scene-video");
    if (video) {
      video.addEventListener("ended", () => {
        state.videoPlaying = false;
        $("section.page")?.classList.remove("is-video-playing");
      });
      video.addEventListener("error", () => {
        state.videoPlaying = false;
        $("section.page")?.classList.remove("is-video-playing");
      });
    }
  }

  root.addEventListener("pointerdown", (e) => {
    pointerStart = { x: e.clientX, y: e.clientY };
  });
  root.addEventListener("pointerup", (e) => {
    if (!pointerStart) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      goTo(state.page + (dx < 0 ? 1 : -1));
      return;
    }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      if (!e.target.closest(".artwork-wrap")) return;
      const layer = $(".sparkle-layer");
      if (!layer) return;
      const id = sparkleId++;
      const span = document.createElement("span");
      span.className = "tap-sparkle";
      span.style.left = e.clientX + "px";
      span.style.top = e.clientY + "px";
      span.innerHTML = "<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>";
      layer.appendChild(span);
      setTimeout(() => span.remove(), 1300);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      goTo(state.page + 1);
    }
    if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      goTo(state.page - 1);
    }
    if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    }
    if (e.key === "End") {
      e.preventDefault();
      goTo(PAGES.length - 1);
    }
  });

  const stored = Number(localStorage.getItem(STORAGE));
  if (Number.isInteger(stored) && stored >= 0 && stored < PAGES.length) state.page = stored;
  render();
})();
