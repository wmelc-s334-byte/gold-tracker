const STORAGE_KEY = "goldTrackJournal_v1";
const $ = (id) => document.getElementById(id);

let data = loadData();
let currentTab = "all";
let selectedFoodNutrition = null;
const FDC_KEY_STORAGE = "goldTrackFdcApiKey_v1";
const USDA_DEMO_KEY = "DEMO_KEY";

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.workouts) && Array.isArray(saved.food)) return { workouts: saved.workouts, food: saved.food, water: Array.isArray(saved.water) ? saved.water : [] };
  } catch (error) {}
  return { workouts: [], food: [], water: [] };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

$("workoutDate").value = todayISO();
$("foodDate").value = todayISO();
$("waterDate").value = todayISO();
$("calendarMonth").value = todayISO().slice(0, 7);
if ($("fdcApiKey")) $("fdcApiKey").value = localStorage.getItem(FDC_KEY_STORAGE) || "";
$("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric"
}).toUpperCase();

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

$("workoutForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "workout",
    exercise: $("exercise").value.trim(),
    date: $("workoutDate").value,
    sets: Number($("sets").value),
    reps: Number($("reps").value),
    load: $("load").value === "" ? null : Number($("load").value),
    effort: $("effort").value,
    notes: $("workoutNotes").value.trim(),
    createdAt: Date.now()
  };

  if (!entry.exercise || !entry.date || entry.sets < 1 || entry.reps < 1) return;
  data.workouts.push(entry);
  saveData();
  $("workoutForm").reset();
  $("workoutDate").value = todayISO();
  $("sets").value = 3;
  $("reps").value = 8;
  render();
  toast("Workout entry saved!");
});


function getNutrient(food, nutrientNumbers, nameFallback) {
  const nutrients = food.foodNutrients || [];
  const found = nutrients.find(n => nutrientNumbers.includes(String(n.nutrientNumber || n.number || "")) ||
    nutrientNumbers.includes(String(n.nutrientId || "")) ||
    (nameFallback && String(n.nutrientName || n.name || "").toLowerCase().includes(nameFallback)));
  if (!found) return 0;
  let value = Number(found.value ?? found.amount ?? 0);
  const unit = String(found.unitName || found.unit || "").toLowerCase();
  if (nameFallback === "energy" && unit === "kj") value = value / 4.184;
  return Number.isFinite(value) ? value : 0;
}

function nutritionFromSearchResult(food) {
  return {
    calories: getNutrient(food, ["208", "1008"], "energy"),
    protein: getNutrient(food, ["203", "1003"], "protein"),
    carbs: getNutrient(food, ["205", "1005"], "carbohydrate"),
    fat: getNutrient(food, ["204", "1004"], "total lipid"),
    fiber: getNutrient(food, ["291", "1079"], "fiber"),
    basis: "100g"
  };
}

function setFoodSearchStatus(message, isError = false) {
  const el = $("foodSearchStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error-text", isError);
}

async function searchFoodDatabase() {
  const query = $("foodSearchInput").value.trim();
  if (query.length < 2) {
    setFoodSearchStatus("Enter at least 2 letters to search.");
    return;
  }
  const btn = $("foodSearchBtn");
  btn.disabled = true;
  btn.textContent = "Searching…";
  $("foodSearchResults").innerHTML = "";
  setFoodSearchStatus("Searching the USDA food database…");
  try {
    const key = localStorage.getItem(FDC_KEY_STORAGE) || USDA_DEMO_KEY;
    const params = new URLSearchParams({ api_key: key });
    const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        pageSize: 15,
        dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"]
      })
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new Error("USDA access limit reached. Add your free personal API key under Database settings, or try again later.");
      throw new Error(`Food database request failed (${response.status}).`);
    }
    const payload = await response.json();
    const results = (payload.foods || []).filter(food => food.description);
    if (!results.length) {
      setFoodSearchStatus("No matching foods found. Try a simpler search, such as “apple”, “spinach”, or “chicken”.");
      return;
    }
    $("foodSearchResults").innerHTML = results.map((food, index) => {
      const n = nutritionFromSearchResult(food);
      const title = safeText(food.description);
      const kind = safeText(food.dataType || "USDA food");
      return `<div class="food-result">
        <div><strong>${title}</strong><div class="food-result-meta"><small>${kind} · per 100 g</small></div></div>
        <div class="food-result-kcal">${Math.round(n.calories)} kcal</div>
        <button class="text-button" type="button" data-food-result="${index}">＋ Add food</button>
      </div>`;
    }).join("");
    // Keep the returned records in memory only for the current search results.
    $("foodSearchResults")._foods = results;
    $("foodSearchResults").querySelectorAll("[data-food-result]").forEach(button => {
      button.addEventListener("click", () => {
        const food = $("foodSearchResults")._foods[Number(button.dataset.foodResult)];
        if (food) selectDatabaseFood(food);
      });
    });
    setFoodSearchStatus(`${results.length} foods found. Choose the closest match; nutrition values are shown per 100 g.`);
  } catch (error) {
    setFoodSearchStatus(error.message || "Could not reach the food database. Check your internet connection.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Search";
  }
}

function selectDatabaseFood(food) {
  selectedFoodNutrition = nutritionFromSearchResult(food);
  $("foodName").value = food.description || "";
  $("foodAmount").value = "100";
  $("foodUnit").value = "grams";
  applySelectedFoodPortion();
  $("foodName").focus();
  setFoodSearchStatus(`Added ${food.description}. Adjust the portion amount in grams or ounces; calories and macros recalculate automatically.`);
  $("foodForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function applySelectedFoodPortion() {
  if (!selectedFoodNutrition) return;
  const amount = Number($("foodAmount").value);
  if (!Number.isFinite(amount) || amount < 0) return;
  const unit = $("foodUnit").value;
  let grams;
  if (unit === "grams") grams = amount;
  else if (unit === "ounces") grams = amount * 28.3495;
  else {
    setFoodSearchStatus("For database foods, use grams or ounces for accurate portion scaling. Other units do not have a standard weight.");
    return;
  }
  const factor = grams / 100;
  $("foodCalories").value = (selectedFoodNutrition.calories * factor).toFixed(1);
  $("foodProtein").value = (selectedFoodNutrition.protein * factor).toFixed(1);
  $("foodCarbs").value = (selectedFoodNutrition.carbs * factor).toFixed(1);
  $("foodFat").value = (selectedFoodNutrition.fat * factor).toFixed(1);
  $("foodFiber").value = (selectedFoodNutrition.fiber * factor).toFixed(1);
}

$("foodSearchBtn").addEventListener("click", searchFoodDatabase);
$("foodSearchInput").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); searchFoodDatabase(); }
});
$("foodName").addEventListener("input", () => { selectedFoodNutrition = null; });
$("foodAmount").addEventListener("input", applySelectedFoodPortion);
$("foodUnit").addEventListener("change", applySelectedFoodPortion);
$("saveApiKeyBtn").addEventListener("click", () => {
  const key = $("fdcApiKey").value.trim();
  if (key) localStorage.setItem(FDC_KEY_STORAGE, key);
  else localStorage.removeItem(FDC_KEY_STORAGE);
  toast(key ? "USDA API key saved on this device." : "Using USDA demo access.");
});

$("foodForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "food",
    meal: $("mealType").value,
    name: $("foodName").value.trim(),
    date: $("foodDate").value,
    feeling: $("foodFeeling").value,
    amount: $("foodAmount").value === "" ? null : Number($("foodAmount").value),
    unit: $("foodUnit").value,
    group: $("foodGroup").value,
    protein: $("foodProtein").value === "" ? null : Number($("foodProtein").value),
    carbs: $("foodCarbs").value === "" ? null : Number($("foodCarbs").value),
    fat: $("foodFat").value === "" ? null : Number($("foodFat").value),
    calories: $("foodCalories").value === "" ? null : Number($("foodCalories").value),
    fiber: $("foodFiber").value === "" ? null : Number($("foodFiber").value),
    micros: $("foodMicros").value.trim(),
    notes: $("foodNotes").value.trim(),
    createdAt: Date.now()
  };
  if (!entry.name || !entry.date) return;
  data.food.push(entry);
  saveData();
  $("foodForm").reset();
  selectedFoodNutrition = null;
  $("foodDate").value = todayISO();
$("waterDate").value = todayISO();
$("calendarMonth").value = todayISO().slice(0, 7);
  render();
  toast("Food journal entry saved!");
});


$("waterForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "water",
    amount: Number($("waterAmount").value),
    unit: $("waterUnit").value,
    date: $("waterDate").value,
    createdAt: Date.now()
  };
  if (!entry.amount || entry.amount < 1 || !entry.date) return;
  data.water = data.water || [];
  data.water.push(entry);
  saveData();
  $("waterForm").reset();
  $("waterDate").value = todayISO();
  render();
  toast("Water entry saved!");
});

function renderCalories() {
  const selectedDate = $("foodDate").value || todayISO();
  const entries = data.food.filter(x => x.date === selectedDate && x.calories != null && Number.isFinite(Number(x.calories)));
  const total = entries.reduce((sum, x) => sum + Number(x.calories), 0);
  $("dailyCalories").textContent = Math.round(total).toLocaleString();
  $("calorieDateLabel").textContent = selectedDate === todayISO() ? "today" : selectedDate;
}

$("foodDate").addEventListener("change", renderCalories);

function renderWater() {
  const entries = (data.water || []).filter(x => x.date === todayISO());
  if (!entries.length) {
    $("waterSummary").textContent = "No water entries yet today.";
    return;
  }
  const totalMl = entries.reduce((sum, x) => sum + x.amount * (x.unit === "oz" ? 29.5735 : x.unit === "cups" ? 236.588 : 1), 0);
  $("waterSummary").innerHTML = `<strong>${entries.length}</strong> water entries logged today <span>·</span> ${Math.round(totalMl)} mL recorded`;
}

function renderRecords() {
  const best = new Map();
  data.workouts.filter(w => w.load !== null && Number.isFinite(Number(w.load))).forEach(w => {
    const key = w.exercise.toLowerCase();
    const prev = best.get(key);
    if (!prev || Number(w.load) > Number(prev.load)) best.set(key, w);
  });
  const rows = [...best.values()].sort((a,b) => a.exercise.localeCompare(b.exercise));
  $("recordList").innerHTML = rows.length ? rows.map(w => `
    <div class="record-item"><strong>${safeText(w.exercise)}</strong><span>${safeText(w.load)} lb</span><small>Best logged · ${safeText(w.date)}</small></div>
  `).join("") : '<p class="empty-state">Log workouts with weights to see your milestones here.</p>';
}

function renderCalendar() {
  const value = $("calendarMonth").value || todayISO().slice(0,7);
  const [year, month] = value.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const active = new Map();
  [...data.workouts.map(x => [x.date, "workout"]), ...data.food.map(x => [x.date, "food"]), ...(data.water || []).map(x => [x.date, "water"])].forEach(([date, kind]) => {
    active.set(date, [...(active.get(date) || []), kind]);
  });
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  $("calendarGrid").innerHTML = names.map(n => `<div class="calendar-day-name">${n}</div>`).join("");
  for (let i=0;i<startDay;i++) $("calendarGrid").innerHTML += '<div class="calendar-day blank"></div>';
  for (let day=1; day<=daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const kinds = active.get(date) || [];
    $("calendarGrid").innerHTML += `<div class="calendar-day ${kinds.length ? "has-entry" : ""}"><strong>${day}</strong><small>${[...new Set(kinds)].map(k => k === "workout" ? "●" : k === "food" ? "◆" : "○").join(" ")}</small></div>`;
  }
}

$("calendarMonth").addEventListener("change", renderCalendar);

function getAchievements() {
  const workouts = data.workouts;
  const uniqueDays = new Set(workouts.map(w => w.date)).size;
  const uniqueExercises = new Set(workouts.map(w => w.exercise.toLowerCase())).size;
  const achievements = [
    { title: "First Session", desc: "Log your first workout.", icon: "✦", earned: workouts.length >= 1 },
    { title: "Finding Your Rhythm", desc: "Log 5 workout sessions.", icon: "♜", earned: workouts.length >= 5 },
    { title: "Regular Practice", desc: "Log 10 workout sessions.", icon: "⚡", earned: workouts.length >= 10 },
    { title: "Movement Explorer", desc: "Try 5 different exercises.", icon: "◇", earned: uniqueExercises >= 5 },
    { title: "Showed Up", desc: "Be active on 3 different days.", icon: "☀", earned: uniqueDays >= 3 },
    { title: "Food Journal Starter", desc: "Log your first meal.", icon: "◈", earned: data.food.length >= 1 },
    { title: "Food Journal Habit", desc: "Log 10 meals or snacks.", icon: "✧", earned: data.food.length >= 10 }
  ];
  return achievements;
}

function renderStats() {
  $("workoutCount").textContent = data.workouts.length;
  $("exerciseCount").textContent = data.workouts.length;
  $("mealCount").textContent = data.food.length;
  $("achievementCount").textContent = getAchievements().filter(a => a.earned).length;
}

function renderAchievements() {
  $("achievementList").innerHTML = getAchievements().map(a => `
    <div class="achievement ${a.earned ? "" : "locked"}">
      <div class="achievement-icon">${a.earned ? a.icon : "🔒"}</div>
      <div><strong>${safeText(a.title)} ${a.earned ? "✓" : ""}</strong>
      <small>${safeText(a.desc)}</small></div>
    </div>
  `).join("");
}

function renderActivity() {
  const all = [
    ...data.workouts.map(x => ({...x, kind: "workout"})),
    ...data.food.map(x => ({...x, kind: "food"})),
    ...(data.water || []).map(x => ({...x, kind: "water"}))
  ].filter(x => currentTab === "all" || x.kind === currentTab)
   .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (!all.length) {
    $("activityList").innerHTML = '<p class="empty-state">No entries yet. Add a workout or food journal entry above.</p>';
    return;
  }

  $("activityList").innerHTML = all.map(item => {
    if (item.kind === "water") {
      return `<div class="activity-item"><div><div class="activity-title">Water · ${safeText(item.amount)} ${safeText(item.unit)}</div><div class="activity-sub">${safeText(item.date)}</div></div><span class="activity-tag">WATER</span></div>`;
    }
    if (item.kind === "workout") {
      const loadText = item.load === null ? "Weight not recorded" : `${item.load} lb used`;
      return `<div class="activity-item">
        <div><div class="activity-title">${safeText(item.exercise)}</div>
        <div class="activity-sub">${safeText(item.date)} · ${item.sets} sets × ${item.reps} reps · ${loadText}</div></div>
        <span class="activity-tag">WORKOUT</span>
      </div>`;
    }
    const portion = item.amount ? ` · ${safeText(item.amount)} ${safeText(item.unit)}` : "";
    const nutrition = [item.calories != null ? `${Math.round(Number(item.calories))} kcal` : "", item.protein != null ? `Protein ${item.protein}g` : "", item.carbs != null ? `Carbs ${item.carbs}g` : "", item.fat != null ? `Fat ${item.fat}g` : "", item.fiber != null ? `Fiber ${item.fiber}g` : ""].filter(Boolean).join(" · ");
    return `<div class="activity-item">
      <div><div class="activity-title">${safeText(item.meal)} · ${safeText(item.name)}${portion}</div>
      <div class="activity-sub">${safeText(item.date)} · ${safeText(item.feeling)}${nutrition ? " · " + safeText(nutrition) : ""}${item.micros ? " · " + safeText(item.micros) : ""}</div></div>
      <span class="activity-tag">FOOD</span>
    </div>`;
  }).join("");
}

function drawChart() {
  const canvas = $("progressChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    days.push({ iso, label: d.toLocaleDateString(undefined, { weekday: "short" }) });
  }
  const counts = days.map(day => data.workouts.filter(w => w.date === day.iso).length);
  const max = Math.max(3, ...counts);
  const pad = { left: 34, right: 16, top: 18, bottom: 32 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  ctx.font = "12px DM Sans, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + chartH - (chartH * i / 3);
    ctx.strokeStyle = "#343536";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#8f8e89";
    ctx.fillText(String(Math.round(max * i / 3)), pad.left - 9, y + 4);
  }

  const slot = chartW / 7;
  counts.forEach((count, i) => {
    const barW = Math.min(43, slot * .48);
    const barH = count === 0 ? 3 : (count / max) * chartH;
    const x = pad.left + slot * i + (slot - barW) / 2;
    const y = pad.top + chartH - barH;
    ctx.fillStyle = "#d9aa50";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, 6);
    else ctx.rect(x, y, barW, barH);
    ctx.fill();
    ctx.fillStyle = "#aaa9a3";
    ctx.textAlign = "center";
    ctx.fillText(days[i].label, x + barW / 2, height - 10);
    if (count > 0) {
      ctx.fillStyle = "#f3d28f";
      ctx.fillText(String(count), x + barW / 2, Math.max(12, y - 7));
    }
  });
}

function render() {
  renderStats();
  renderAchievements();
  renderActivity();
  renderWater();
  renderCalories();
  renderRecords();
  renderCalendar();
  drawChart();
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    button.classList.add("active");
    currentTab = button.dataset.tab;
    renderActivity();
  });
});

$("clearBtn").addEventListener("click", () => {
  if (!confirm("Delete all workout and food journal entries from this browser? This cannot be undone.")) return;
  data = { workouts: [], food: [], water: [] };
  saveData();
  render();
  toast("Your journal has been cleared.");
});

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gold-track-journal.json";
  link.click();
  URL.revokeObjectURL(url);
  toast("Journal backup downloaded.");
});

render();
