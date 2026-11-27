(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const appView = $("appView");
  const authForm = $("authForm");
  const authNotice = $("authNotice");
  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const connections = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const fingerColors = ["#9f91ff", "#61e5d0", "#ffa878", "#8be0a4", "#f0ca77"];

  let supabaseClient;
  let user;
  let authMode = "signin";
  let cameraStream;
  let hands;
  let running = false;
  let paused = false;
  let muted = false;
  let processing = false;
  let session = 0;
  let detector;
  let detectorLoading = false;
  let lastObjectCheck = 0;
  let lastSpeechAt = 0;
  let lastAnnounced = "";
  let historyRows = [];
  let toastTimer;
  let trails = [];
  let previousCenter;
  let lastMovement = "";

  function showNotice(message, isError) {
    authNotice.textContent = message;
    authNotice.classList.toggle("error", Boolean(isError));
  }

  function toast(message, isError) {
    const element = $("toast");
    element.textContent = message;
    element.classList.toggle("error", Boolean(isError));
    element.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove("visible"), 3800);
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signingIn = mode === "signin";
    $("authHeading").textContent = signingIn ? "Your vision, amplified." : "Create your IRIS account.";
    $("authSubtitle").textContent = signingIn ? "Sign in to open your private workspace." : "A few details and your workspace is ready.";
    $("authSubmit").innerHTML = signingIn ? 'Sign in <span>→</span>' : 'Create account <span>→</span>';
    $("authSwitchText").textContent = signingIn ? "New to IRIS?" : "Already have an account?";
    $("authSwitch").textContent = signingIn ? "Create an account" : "Sign in instead";
    $("password").autocomplete = signingIn ? "current-password" : "new-password";
    showNotice("", false);
  }

  function showApp(sessionUser) {
    user = sessionUser;
    authView.hidden = true;
    appView.hidden = false;
    $("userEmail").textContent = user.email || "Signed in";
    $("userAvatar").textContent = (user.email || "I").slice(0, 1);
    $("todayLabel").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date()).toUpperCase();
    loadActivity();
  }

  function showAuth() {
    stopCamera();
    user = null;
    appView.hidden = true;
    authView.hidden = false;
    $("password").value = "";
  }

  async function loadConfig() {
    const response = await fetch("/api/config", { headers: { Accept: "application/json" }, cache: "no-store" });
    const config = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(config.error || "IRIS is not configured yet. Add the Supabase project settings to your deployment.");
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
      throw new Error("Supabase configuration is incomplete. Check your Vercel environment variables.");
    }
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session) showApp(data.session.user);
    else authView.hidden = false;
    supabaseClient.auth.onAuthStateChange((_event, sessionState) => {
      if (sessionState) showApp(sessionState.user);
      else showAuth();
    });
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabaseClient) return showNotice("Authentication is not configured. Please try again later.", true);
    const submit = $("authSubmit");
    const email = $("email").value.trim();
    const password = $("password").value;
    submit.disabled = true;
    showNotice(authMode === "signin" ? "Signing you in…" : "Creating your account…", false);
    try {
      if (authMode === "signin") {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          showNotice("Check your email for a confirmation link. You can sign in once your address is verified.", false);
          authForm.reset();
        }
      }
    } catch (error) {
      showNotice(error.message || "Unable to authenticate. Please try again.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("authSwitch").addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
  $("signOut").addEventListener("click", async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) toast(`Could not sign out: ${error.message}`, true);
  });

  async function loadActivity() {
    const list = $("activityList");
    list.innerHTML = '<div class="empty-activity">Loading your activity…</div>';
    const { data, error } = await supabaseClient.from("activity_events")
      .select("id,event_type,description,created_at")
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) {
      list.innerHTML = '<div class="empty-activity">Activity could not be loaded. Check the Supabase table setup and try again.</div>';
      toast(`Activity load failed: ${error.message}`, true);
      return;
    }
    historyRows = data || [];
    renderActivity();
  }

  function renderActivity() {
    const list = $("activityList");
    if (!historyRows.length) {
      list.innerHTML = '<div class="empty-activity">Your recognized gestures and objects will appear here.</div>';
      return;
    }
    list.replaceChildren(...historyRows.map((row) => {
      const item = document.createElement("div");
      item.className = "activity-row";
      const symbol = document.createElement("span");
      symbol.className = "activity-symbol";
      symbol.textContent = row.event_type === "object" ? "▧" : row.event_type === "movement" ? "↗" : "✳";
      const description = document.createElement("div");
      description.className = "activity-description";
      description.append(document.createTextNode(row.description));
      const type = document.createElement("span");
      type.className = "activity-type";
      type.textContent = row.event_type;
      description.append(type);
      const time = document.createElement("time");
      time.className = "activity-time";
      time.dateTime = row.created_at;
      time.textContent = relativeTime(row.created_at);
      item.append(symbol, description, time);
      return item;
    }));
  }

  function relativeTime(value) {
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return "JUST NOW";
    if (minutes < 60) return `${minutes}M AGO`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}H AGO`;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)).toUpperCase();
  }

  async function saveActivity(type, description) {
    if (!user || !supabaseClient) return;
    const { data, error } = await supabaseClient.from("activity_events")
      .insert({ user_id: user.id, event_type: type, description })
      .select("id,event_type,description,created_at")
      .single();
    if (error) {
      toast(`Could not save activity: ${error.message}`, true);
      return;
    }
    historyRows.unshift(data);
    historyRows = historyRows.slice(0, 12);
    renderActivity();
  }

  function say(message, eventKey, type) {
    $("response").textContent = message;
    const now = Date.now();
    if (eventKey && (eventKey !== lastAnnounced || now - lastSpeechAt > 8000)) {
      lastAnnounced = eventKey;
      lastSpeechAt = now;
      if (type) saveActivity(type, message);
      if (!muted && !paused && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = Number($("speed").value);
        utterance.pitch = .95;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    }
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }

  function jointAngle(a, b, c) {
    const u = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
    const v = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
    const length = Math.hypot(...u) * Math.hypot(...v);
    if (!length) return 0;
    const dot = u.reduce((sum, value, index) => sum + value * v[index], 0);
    return Math.acos(Math.max(-1, Math.min(1, dot / length))) * 180 / Math.PI;
  }

  function recognizeGesture(points) {
    const palm = distance(points[0], points[9]);
    const thumb = jointAngle(points[2], points[3], points[4]) > 145 && distance(points[4], points[5]) > palm * .55;
    const extended = [thumb];
    for (const tip of [8, 12, 16, 20]) {
      extended.push(jointAngle(points[tip - 3], points[tip - 2], points[tip]) > 150 && distance(points[tip], points[0]) > distance(points[tip - 2], points[0]));
    }
    const [t, index, middle, ring, pinky] = extended;
    const count = extended.filter(Boolean).length;
    if (distance(points[4], points[8]) < palm * .3 && middle && ring && pinky) return "OK sign";
    if (t && !index && !middle && !ring && !pinky) {
      if (points[4].y < points[2].y - palm * .3) return "Thumbs up";
      if (points[4].y > points[2].y + palm * .3) return "Thumbs down";
    }
    if (!t && index && middle && !ring && !pinky) return "Peace sign";
    if (!t && index && !middle && !ring && pinky) return "Rock sign";
    if (count === 5) return "Open palm";
    if (count === 0) return "Closed fist";
    if (!t && index && !middle && !ring && !pinky) return "Pointing";
    return `${count} ${count === 1 ? "finger" : "fingers"}`;
  }

  function detectMovement(points) {
    const center = points[0];
    if (!previousCenter) {
      previousCenter = { x: center.x, y: center.y };
      return "Hand detected";
    }
    const dx = center.x - previousCenter.x;
    const dy = center.y - previousCenter.y;
    previousCenter = { x: center.x, y: center.y };
    if (Math.abs(dx) > .018) return dx > 0 ? "Moving left" : "Moving right";
    if (Math.abs(dy) > .018) return dy > 0 ? "Moving down" : "Moving up";
    return "Hand steady";
  }

  function drawHand(points) {
    const width = canvas.width;
    const height = canvas.height;
    for (const [from, to] of connections) {
      ctx.beginPath();
      ctx.moveTo(points[from].x * width, points[from].y * height);
      ctx.lineTo(points[to].x * width, points[to].y * height);
      ctx.strokeStyle = "#69e5d2";
      ctx.lineWidth = Math.max(2, width / 360);
      ctx.stroke();
    }
    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, Math.max(2.5, width / 260), 0, Math.PI * 2);
      ctx.fillStyle = index === 0 ? "#ffffff" : fingerColors[Math.min(4, Math.max(0, Math.floor((index - 1) / 4)))];
      ctx.fill();
    });
    const trailLength = Number($("trailLength").value);
    for (const tip of [4, 8, 12, 16, 20]) {
      trails.push({ x: points[tip].x * width, y: points[tip].y * height, time: performance.now(), color: fingerColors[Math.min(4, Math.floor((tip - 1) / 4))] });
    }
    trails = trails.slice(-trailLength * 5);
  }

  function drawTrails() {
    const now = performance.now();
    const life = Number($("trailLength").value) * 55;
    trails = trails.filter((point) => now - point.time < life);
    for (let index = 1; index < trails.length; index += 1) {
      const before = trails[index - 1];
      const point = trails[index];
      ctx.globalAlpha = Math.max(0, 1 - (now - point.time) / life) * .68;
      ctx.beginPath();
      ctx.moveTo(before.x, before.y);
      ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = point.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function onResults(results) {
    if (!running || paused) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const detected = results.multiHandLandmarks || [];
    $("handCount").textContent = String(detected.length).padStart(2, "0");
    $("handDetail").textContent = detected.length === 1 ? "One hand in view" : `${detected.length} hands in view`;
    if (detected.length) {
      const gesture = recognizeGesture(detected[0]);
      const movement = detectMovement(detected[0]);
      $("gesture").textContent = detected.length > 1 ? `${gesture} + ${recognizeGesture(detected[1])}` : gesture;
      $("gestureDetail").textContent = "Recognized in your browser";
      $("movement").textContent = movement;
      detected.forEach(drawHand);
      drawTrails();
      if (gesture !== lastAnnounced && !["Hand steady", "Hand detected"].includes(gesture)) {
        say(`I can see a ${gesture.toLowerCase()}.`, `gesture:${gesture}`, "gesture");
      }
      if (!["Hand steady", "Hand detected"].includes(movement) && movement !== lastMovement) {
        lastMovement = movement;
        saveActivity("movement", movement);
      }
    } else {
      $("gesture").textContent = "No hand";
      $("gestureDetail").textContent = "Move a hand into the frame";
      $("movement").textContent = "—";
      previousCenter = null;
      lastMovement = "";
    }
  }

  async function enableObjects() {
    if (detector || detectorLoading) return;
    detectorLoading = true;
    $("objectsButton").disabled = true;
    $("object").textContent = "Loading model…";
    try {
      if (!window.tf) await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      if (!window.cocoSsd) await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js");
      detector = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
      $("objectsButton").innerHTML = "✓ <span>Objects ready</span>";
      $("object").textContent = "Ready";
      $("confidence").textContent = "Waiting for camera";
      toast("Object recognition is ready. Start the camera to use it.");
    } catch (error) {
      $("object").textContent = "Unavailable";
      $("confidence").textContent = "Could not load detection model";
      toast(error.message || "Could not load object recognition.", true);
      $("objectsButton").disabled = false;
    } finally {
      detectorLoading = false;
    }
  }

  async function loadScript(src) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error("Could not load the recognition model. Check your internet connection."));
      };
      document.head.append(script);
    });
  }

  async function detectObjects(currentSession) {
    if (!detector || paused || !running || Date.now() - lastObjectCheck < 1500) return;
    lastObjectCheck = Date.now();
    const predictions = await detector.detect(video, 10, .65);
    if (!running || paused || currentSession !== session) return;
    const item = predictions.filter((prediction) => prediction.class !== "person").sort((a, b) => b.score - a.score)[0];
    if (!item) {
      $("object").textContent = "Nothing detected";
      $("confidence").textContent = "Keep an object in frame";
      return;
    }
    const label = item.class[0].toUpperCase() + item.class.slice(1);
    $("object").textContent = label;
    $("confidence").textContent = `${Math.round(item.score * 100)}% confidence`;
    say(`I can see what looks like a ${item.class}.`, `object:${item.class}`, "object");
  }

  async function initializeHands() {
    if (hands) return;
    if (!window.Hands) await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js");
    hands = new window.Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}` });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: .65, minTrackingConfidence: .65 });
    hands.onResults(onResults);
  }

  async function startCamera() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $("cameraHelp").textContent = "Camera access requires HTTPS and a supported browser.";
      toast("Open IRIS over HTTPS to use your camera.", true);
      return;
    }
    $("cameraButton").disabled = true;
    $("cameraHelp").textContent = "Requesting camera permission…";
    const currentSession = ++session;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
      if (currentSession !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream = stream;
      video.srcObject = stream;
      await video.play();
      await initializeHands();
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      running = true;
      paused = false;
      $("cameraPlaceholder").hidden = true;
      $("cameraButton").innerHTML = '<span class="button-symbol">■</span> Stop camera';
      $("pauseButton").disabled = false;
      $("pauseButton").innerHTML = 'Ⅱ <span>Pause</span>';
      $("status").classList.add("online");
      $("status").innerHTML = '<span class="status-dot"></span> CAMERA LIVE';
      $("feedLabel").textContent = "LIVE";
      $("cameraHelp").textContent = "Live processing is running in this browser tab.";
      stream.getVideoTracks()[0].addEventListener("ended", stopCamera, { once: true });
      say("Your camera is live. I am ready to recognize gestures.", "camera:started");
      processFrame(currentSession);
    } catch (error) {
      stopCamera();
      $("cameraHelp").textContent = error.name === "NotAllowedError" ? "Camera permission was denied. Allow access in your browser settings, then try again." : error.message;
      toast(`Camera could not start: ${error.message}`, true);
    } finally {
      $("cameraButton").disabled = false;
    }
  }

  async function processFrame(currentSession) {
    if (!running || currentSession !== session) return;
    if (!paused && !processing && video.readyState >= 2) {
      processing = true;
      try {
        await hands.send({ image: video });
        await detectObjects(currentSession);
      } catch (error) {
        toast(`Vision processing stopped: ${error.message}`, true);
        stopCamera();
      } finally {
        processing = false;
      }
    }
    if (running && currentSession === session) window.setTimeout(() => processFrame(currentSession), 70);
  }

  function stopCamera() {
    running = false;
    session += 1;
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    video.srcObject = null;
    window.speechSynthesis?.cancel();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trails = [];
    previousCenter = null;
    $("cameraPlaceholder").hidden = false;
    $("cameraButton").innerHTML = '<span class="button-symbol">▶</span> Start camera';
    $("pauseButton").disabled = true;
    $("pauseButton").innerHTML = 'Ⅱ <span>Pause</span>';
    $("status").classList.remove("online");
    $("status").innerHTML = '<span class="status-dot"></span> CAMERA OFF';
    $("feedLabel").textContent = "STANDBY";
    $("handCount").textContent = "—";
    $("handDetail").textContent = "Start camera to detect hands";
    $("gesture").textContent = "Waiting";
    $("gestureDetail").textContent = "Your gestures appear here";
    $("movement").textContent = "—";
    paused = false;
    processing = false;
  }

  $("cameraButton").addEventListener("click", () => running ? stopCamera() : startCamera());
  $("pauseButton").addEventListener("click", () => {
    if (!running) return;
    paused = !paused;
    $("pauseButton").innerHTML = paused ? '▶ <span>Resume</span>' : 'Ⅱ <span>Pause</span>';
    $("status").innerHTML = paused ? '<span class="status-dot"></span> PAUSED' : '<span class="status-dot"></span> CAMERA LIVE';
    $("status").classList.toggle("online", !paused);
    if (paused) window.speechSynthesis?.cancel();
  });
  $("objectsButton").addEventListener("click", enableObjects);
  $("muteButton").addEventListener("click", () => {
    muted = !muted;
    $("muteButton").innerHTML = muted ? '♫ <span>Voice off</span>' : '♫ <span>Voice on</span>';
    if (muted) window.speechSynthesis?.cancel();
  });
  $("clearTrails").addEventListener("click", () => {
    trails = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
  $("speakAgain").addEventListener("click", () => {
    if (!muted && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance($("response").textContent);
      utterance.rate = Number($("speed").value);
      window.speechSynthesis.speak(utterance);
    }
  });
  $("refreshActivity").addEventListener("click", loadActivity);
  $("trailLength").addEventListener("input", (event) => { $("trailValue").textContent = event.target.value; });
  $("speed").addEventListener("input", (event) => { $("speedValue").textContent = `${event.target.value}×`; });
  window.addEventListener("pagehide", stopCamera);

  loadConfig().catch((error) => {
    authView.hidden = false;
    showNotice(error.message || "Could not connect to IRIS services.", true);
    $("authSubmit").disabled = true;
  });
})();
