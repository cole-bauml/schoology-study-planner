import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { apiRequest } from "./api.js";
import type {
  AppSettings,
  ChecklistItem,
  Course,
  DashboardData,
  SyncProgress,
} from "./types.js";

type AppMode = "loading" | "setup" | "login" | "app";
type ViewName = "overview" | "courses" | "settings";

interface ApiStatus {
  setupRequired: boolean;
  authenticated: boolean;
}

function App() {
  const [mode, setMode] = useState<AppMode>("loading");
  const [activeView, setActiveView] = useState<ViewName>("overview");
  const [dashboard, setDashboard] = useState<DashboardData>({
    syncedAt: null,
    courses: [],
  });
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    const data = await apiRequest<DashboardData>("/api/dashboard");
    setDashboard(data);
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const status = await apiRequest<ApiStatus>("/api/status");
        if (!active) return;
        if (status.setupRequired) {
          setMode("setup");
        } else if (!status.authenticated) {
          setMode("login");
        } else {
          setMode("app");
          try {
            await loadDashboard();
          } catch (loadError) {
            if (active) setError(errorMessage(loadError));
          }
        }
      } catch (statusError) {
        if (active) {
          setError(errorMessage(statusError));
          setMode("login");
        }
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [loadDashboard]);

  const handleUnlock = async (password: string) => {
    await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setError("");
    setMode("app");
    await loadDashboard();
  };

  const handleSetup = async (values: {
    schoologyKey: string;
    schoologySecret: string;
    openAiKey: string;
    appPassword: string;
  }) => {
    await apiRequest("/api/setup", {
      method: "POST",
      body: JSON.stringify(values),
    });
    setError("");
    setMode("app");
    await loadDashboard();
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress({
      active: true,
      stage: "schoology",
      message: "Starting Schoology sync",
      updatedAt: new Date().toISOString(),
    });
    setError("");
    let pollActive = true;
    const pollProgress = async () => {
      try {
        const progress = await apiRequest<SyncProgress>("/api/sync/status");
        if (pollActive) setSyncProgress(progress);
      } catch (progressError) {
        if (pollActive) setError(errorMessage(progressError));
      }
    };
    const pollTimer = window.setInterval(() => void pollProgress(), 1000);
    try {
      const data = await apiRequest<DashboardData>("/api/sync", {
        method: "POST",
      });
      setDashboard(data);
    } catch (syncError) {
      setError(errorMessage(syncError));
    } finally {
      pollActive = false;
      window.clearInterval(pollTimer);
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleToggle = async (
    courseId: string,
    itemId: string,
    completed: boolean,
  ) => {
    const previous = dashboard;
    setDashboard((current) => ({
      ...current,
      courses: current.courses.map((course) =>
        course.id === courseId
          ? {
              ...course,
              checklist: course.checklist.map((item) =>
                item.id === itemId ? { ...item, completed } : item,
              ),
            }
          : course,
      ),
    }));
    try {
      await apiRequest(
        `/api/courses/${encodeURIComponent(courseId)}/checklist/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ completed }),
        },
      );
    } catch (toggleError) {
      setDashboard(previous);
      setError(errorMessage(toggleError));
    }
  };

  const handleLogout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setMode("login");
    setActiveView("overview");
    setError("");
  };

  if (mode === "loading") {
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" size={24} />
        <span>Getting your planner ready</span>
      </div>
    );
  }
  if (mode === "setup") {
    return (
      <SetupScreen
        error={error}
        onSubmit={async (values) => {
          try {
            await handleSetup(values);
          } catch (setupError) {
            setError(errorMessage(setupError));
          }
        }}
      />
    );
  }
  if (mode === "login") {
    return (
      <LoginScreen
        error={error}
        onSubmit={async (password) => {
          try {
            await handleUnlock(password);
          } catch (loginError) {
            setError(errorMessage(loginError));
          }
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={(view) => {
          setActiveView(view);
          setError("");
        }}
        onLogout={() => void handleLogout()}
      />
      <main className="main-panel">
        <header className="topbar">
          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {activeView === "overview"
                ? "Overview"
                : activeView === "courses"
                  ? "My courses"
                  : "Settings"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="secure-label">
              <ShieldCheck size={15} />
              Private workspace
            </span>
            <div className="avatar">D</div>
          </div>
        </header>

        <div className="page-content">
          {error && (
            <div className="alert alert-error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button
                className="alert-dismiss"
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
          {activeView === "overview" && (
            <Overview
              dashboard={dashboard}
              syncing={syncing}
              syncProgress={syncProgress}
              onSync={() => void handleSync()}
              onToggle={handleToggle}
              onBrowseCourses={() => setActiveView("courses")}
            />
          )}
          {activeView === "courses" && (
            <CoursesPage dashboard={dashboard} onToggle={handleToggle} />
          )}
          {activeView === "settings" && (
            <SettingsPage
              onError={setError}
              onSaved={() => {
                setError("");
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function SetupScreen({
  error,
  onSubmit,
}: {
  error: string;
  onSubmit: (values: {
    schoologyKey: string;
    schoologySecret: string;
    openAiKey: string;
    appPassword: string;
  }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    schoologyKey: "",
    schoologySecret: "",
    openAiKey: "",
    appPassword: "",
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await onSubmit(form);
    setBusy(false);
  };

  return (
    <div className="gate-screen">
      <div className="gate-aside">
        <div className="brand brand-light">
          <div className="brand-mark">
            <GraduationCap size={21} />
          </div>
          <span>Schoology Planner</span>
        </div>
        <div className="gate-aside-copy">
          <span className="eyebrow eyebrow-light">SCHOOLWORK PLANNER</span>
          <h1>Schoology assignments, in one checklist.</h1>
          <p>
            Find assignments and due dates across your courses, including dates
            mentioned in course materials.
          </p>
        </div>
        <div className="aside-note">
          <ShieldCheck size={17} />
          <span>Your credentials are encrypted before they’re saved.</span>
        </div>
        <div className="gate-decoration gate-decoration-one" />
        <div className="gate-decoration gate-decoration-two" />
      </div>
      <section className="gate-form-wrap">
        <div className="gate-form">
          <div className="mobile-brand brand">
            <div className="brand-mark">
              <GraduationCap size={21} />
            </div>
            <span>Schoology Planner</span>
          </div>
          <span className="eyebrow">FIRST-TIME SETUP</span>
          <h2>Connect Schoology</h2>
          <p className="form-intro">
            Enter your Schoology API keys, an OpenAI API key for course
            analysis, and a password for this app.
          </p>
          {error && <FormError>{error}</FormError>}
          <form onSubmit={submit}>
            <div className="field-group">
              <label htmlFor="schoology-key">Schoology consumer key</label>
              <input
                id="schoology-key"
                autoComplete="off"
                required
                value={form.schoologyKey}
                onChange={(event) =>
                  setForm({ ...form, schoologyKey: event.target.value })
                }
                placeholder="Your API consumer key"
              />
            </div>
            <div className="field-group">
              <label htmlFor="schoology-secret">
                Schoology consumer secret
              </label>
              <input
                id="schoology-secret"
                type="password"
                autoComplete="new-password"
                required
                value={form.schoologySecret}
                onChange={(event) =>
                  setForm({ ...form, schoologySecret: event.target.value })
                }
                placeholder="Your API consumer secret"
              />
              <a
                className="field-hint field-link"
                href="https://Schoology.schoology.com/api"
                target="_blank"
                rel="noreferrer"
              >
                Get your keys from Schoology <ExternalLink size={12} />
              </a>
            </div>
            <div className="field-group">
              <label htmlFor="openai-key">OpenAI API key</label>
              <input
                id="openai-key"
                type="password"
                autoComplete="new-password"
                required
                value={form.openAiKey}
                onChange={(event) =>
                  setForm({ ...form, openAiKey: event.target.value })
                }
                placeholder="Used to find syllabus dates and estimate effort"
              />
              <span className="field-hint">
                Used to analyze course materials; encrypted before saving.
              </span>
            </div>
            <div className="field-group">
              <label htmlFor="app-password">Create your app password</label>
              <div className="password-field">
                <input
                  id="app-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={form.appPassword}
                  onChange={(event) =>
                    setForm({ ...form, appPassword: event.target.value })
                  }
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <span className="field-hint">
                This browser stays signed in for 180 days.
              </span>
            </div>
            <button
              className="button button-primary button-wide"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ArrowRight size={17} />
              )}
              {busy ? "Setting up…" : "Create my planner"}
            </button>
          </form>
          <p className="privacy-note">
            <ShieldCheck size={14} /> Your password is stored as a secure hash.
          </p>
        </div>
      </section>
    </div>
  );
}

function LoginScreen({
  error,
  onSubmit,
}: {
  error: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await onSubmit(password);
    setBusy(false);
  };
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand login-brand">
          <div className="brand-mark">
            <GraduationCap size={21} />
          </div>
          <span>Schoology Planner</span>
        </div>
        <div className="login-lock">
          <ShieldCheck size={24} />
        </div>
        <span className="eyebrow">SIGN IN</span>
        <h1>Enter your password</h1>
        <p>Use the app password you created during setup.</p>
        {error && <FormError>{error}</FormError>}
        <form onSubmit={submit}>
          <div className="field-group">
            <label htmlFor="login-password">App password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your app password"
            />
          </div>
          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowRight size={17} />
            )}
            {busy ? "Unlocking…" : "Unlock planner"}
          </button>
        </form>
        <span className="login-foot">
          <ShieldCheck size={14} /> This browser is remembered for 180 days.
        </span>
      </div>
    </div>
  );
}

function Sidebar({
  activeView,
  onNavigate,
  onLogout,
}: {
  activeView: ViewName;
  onNavigate: (view: ViewName) => void;
  onLogout: () => void;
}) {
  const links: {
    view: ViewName;
    label: string;
    icon: typeof LayoutDashboard;
  }[] = [
    { view: "overview", label: "Overview", icon: LayoutDashboard },
    { view: "courses", label: "My courses", icon: BookOpen },
    { view: "settings", label: "Settings", icon: Settings2 },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <GraduationCap size={21} />
        </div>
        <span>Schoology Planner</span>
      </div>
      <div className="sidebar-label">MENU</div>
      <nav className="side-nav" aria-label="Main navigation">
        {links.map(({ view, label, icon: Icon }) => (
          <button
            className={`nav-link ${activeView === view ? "active" : ""}`}
            key={view}
            onClick={() => onNavigate(view)}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {activeView === view && <span className="nav-active-mark" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-tip">
        <div className="tip-icon">
          <Sparkles size={16} />
        </div>
        <strong>Effort ratings</strong>
        <p>Each task gets a 1–10 estimate based on its course details.</p>
      </div>
      <button className="nav-link logout-link" onClick={onLogout}>
        <LogOut size={18} strokeWidth={1.8} />
        <span>Lock planner</span>
      </button>
      <div className="sidebar-footer">
        <div className="avatar avatar-small">D</div>
        <div className="footer-user">
          <strong>My workspace</strong>
          <span>Schoology planner</span>
        </div>
        <ShieldCheck size={15} className="footer-shield" />
      </div>
    </aside>
  );
}

function Overview({
  dashboard,
  syncing,
  syncProgress,
  onSync,
  onToggle,
  onBrowseCourses,
}: {
  dashboard: DashboardData;
  syncing: boolean;
  syncProgress: SyncProgress | null;
  onSync: () => void;
  onToggle: (courseId: string, itemId: string, completed: boolean) => void;
  onBrowseCourses: () => void;
}) {
  const allItems = useMemo(
    () =>
      dashboard.courses.flatMap((course) =>
        course.checklist.map((item) => ({
          ...item,
          courseId: course.id,
          courseTitle: course.title,
        })),
      ),
    [dashboard.courses],
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const upcoming = allItems
    .filter((item) => {
      if (item.completed || !item.dueDate) return false;
      const date = new Date(`${item.dueDate}T00:00:00`);
      return date >= today && date < weekEnd;
    })
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const completed = allItems.filter((item) => item.completed).length;
  const totalEffort = upcoming.reduce((sum, item) => sum + item.effort, 0);
  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="date-eyebrow">
            <CalendarDays size={14} /> {formattedToday()}
          </div>
          <h1>Assignments and due dates</h1>
          <p className="page-subtitle">
            Tasks from your Schoology courses, sorted by due date.
          </p>
        </div>
        <button
          className="button button-primary sync-button"
          onClick={onSync}
          disabled={syncing}
        >
          {syncing ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          {syncing
            ? "Syncing courses…"
            : dashboard.syncedAt
              ? "Sync Schoology"
              : "Connect Schoology"}
        </button>
      </div>
      {syncing && (
        <div className="sync-progress">
          <div className="sync-progress-bar" />
          <span>
            {syncProgress?.message ??
              "Loading Schoology courses and course materials."}
          </span>
        </div>
      )}
      <div className="stats-grid">
        <StatCard
          icon={<BookOpen size={19} />}
          label="Active courses"
          value={dashboard.courses.length.toString()}
          note={
            dashboard.courses.length
              ? "From your Schoology sections"
              : "Sync Schoology to load courses"
          }
          tone="green"
        />
        <StatCard
          icon={<CalendarDays size={19} />}
          label="Due this week"
          value={upcoming.length.toString()}
          note={
            upcoming.length
              ? "Due in the next 7 days"
              : "None due in the next 7 days"
          }
          tone="yellow"
        />
        <StatCard
          icon={<Clock3 size={19} />}
          label="Effort points"
          value={`${totalEffort}`}
          note="For tasks due in the next 7 days"
          tone="lavender"
        />
        <StatCard
          icon={<CheckCircle2 size={19} />}
          label="Completed tasks"
          value={completed.toString()}
          note="Across all course checklists"
          tone="peach"
        />
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">DUE IN THE NEXT 7 DAYS</span>
          <h2>Upcoming tasks</h2>
        </div>
        <button className="text-button" onClick={onBrowseCourses}>
          See all courses <ArrowRight size={15} />
        </button>
      </div>
      {upcoming.length ? (
        <div className="upcoming-layout">
          <div className="upcoming-list">
            {upcoming.slice(0, 7).map((item) => (
              <TaskRow
                key={`${item.courseId}-${item.id}`}
                item={item}
                courseTitle={item.courseTitle}
                onToggle={(checked) =>
                  onToggle(item.courseId, item.id, checked)
                }
              />
            ))}
          </div>
          <div className="week-card">
            <div className="week-card-top">
              <div className="week-icon">
                <ArrowDownRight size={19} />
              </div>
              <span>This week</span>
            </div>
            <h3>Total effort</h3>
            <p>
              {totalEffort > 0
                ? `${totalEffort} total effort points across ${new Set(upcoming.map((item) => item.courseId)).size} courses.`
                : "No rated tasks due in the next 7 days."}
            </p>
            <div className="week-progress">
              <div className="week-progress-track">
                <span
                  style={{
                    width: `${upcoming.length ? Math.max(6, (completed / (completed + upcoming.length)) * 100) : 0}%`,
                  }}
                />
              </div>
              <span>{completed} completed</span>
            </div>
            <div className="week-card-decoration" />
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<CalendarDays size={22} />}
          title={
            dashboard.syncedAt
                ? "No tasks due in the next 7 days"
                : "No courses loaded"
          }
          description={
            dashboard.syncedAt
              ? "There are no checklist items due in the next 7 days."
              : "Sync Schoology to load your courses, assignments, and calendar events."
          }
          action={
            !dashboard.syncedAt ? (
              <button
                className="button button-primary"
                onClick={onSync}
                disabled={syncing}
              >
                <RefreshCw size={15} /> Sync Schoology
              </button>
            ) : undefined
          }
        />
      )}
      {dashboard.syncedAt && (
        <div className="last-synced">
          <span className="sync-dot" /> Last synced{" "}
          {new Date(dashboard.syncedAt).toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </div>
      )}
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </div>
  );
}

function CoursesPage({
  dashboard,
  onToggle,
}: {
  dashboard: DashboardData;
  onToggle: (courseId: string, itemId: string, completed: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedCourse = dashboard.courses.find(
    (course) => course.id === selectedId,
  );
  return (
    <>
      <div className="page-title-block">
        <span className="eyebrow">COURSE LIST</span>
        <h1>Your courses</h1>
        <p className="page-subtitle">
          Assignments, calendar events, and course-material dates.
        </p>
      </div>
      {!dashboard.courses.length ? (
        <EmptyState
          icon={<BookOpen size={22} />}
          title="No courses loaded"
          description="Go to Overview and sync Schoology to load your courses and assignments."
        />
      ) : selectedCourse ? (
        <CourseDetail
          course={selectedCourse}
          onBack={() => setSelectedId(null)}
          onToggle={onToggle}
        />
      ) : (
        <div className="courses-grid">
          {dashboard.courses.map((course, index) => {
            const openItems = course.checklist.filter(
              (item) => !item.completed,
            );
            return (
              <button
                className="course-card"
                key={course.id}
                onClick={() => setSelectedId(course.id)}
              >
                <div className={`course-card-art art-${index % 4}`}>
                  <div className="course-art-icon">
                    <BookOpen size={20} />
                  </div>
                  <span>
                    {course.courseCode ||
                      `COURSE ${String(index + 1).padStart(2, "0")}`}
                  </span>
                  <div className="course-art-orb" />
                </div>
                <div className="course-card-body">
                  <div className="course-card-title-row">
                    <h3>{course.title}</h3>
                    <ChevronRight size={17} />
                  </div>
                  <p>
                    {course.syllabus ||
                      "No syllabus summary found. Sync again after syllabus content is available."}
                  </p>
                  <div className="course-card-footer">
                    <span>
                      <ListIcon /> {openItems.length} upcoming{" "}
                      {openItems.length === 1 ? "item" : "items"}
                    </span>
                    <span>
                      {course.checklist.filter((item) => item.completed).length}{" "}
                      done
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function CourseDetail({
  course,
  onBack,
  onToggle,
}: {
  course: Course;
  onBack: () => void;
  onToggle: (courseId: string, itemId: string, completed: boolean) => void;
}) {
  const sortedItems = [...course.checklist].sort((a, b) => {
    if (a.completed !== b.completed)
      return Number(a.completed) - Number(b.completed);
    if (!a.dueDate) return b.dueDate ? 1 : a.title.localeCompare(b.title);
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  return (
    <div className="course-detail">
      <button className="back-button" onClick={onBack}>
        ← All courses
      </button>
      <div className="detail-title">
        <div className="detail-icon">
          <BookOpen size={22} />
        </div>
        <div>
          <span className="eyebrow">{course.courseCode || "COURSE"}</span>
          <h2>{course.title}</h2>
        </div>
      </div>
      <div className="detail-columns">
        <section className="detail-main">
          <div className="detail-section-title">
            <div>
              <span className="eyebrow">ASSIGNMENTS AND EVENTS</span>
              <h3>Course checklist</h3>
            </div>
            <span className="item-count">{course.checklist.length} items</span>
          </div>
          {sortedItems.length ? (
            <div className="task-list-card">
              {sortedItems.map((item) => (
                <TaskRow
                  key={item.id}
                  item={item}
                  courseTitle={course.title}
                  onToggle={(checked) => onToggle(course.id, item.id, checked)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CheckCircle2 size={21} />}
              title="No checklist items found"
              description="Sync Schoology again to check this course for assignments and calendar events."
            />
          )}
        </section>
        <aside className="syllabus-card">
          <div className="syllabus-heading">
            <div className="syllabus-icon">
              <Sparkles size={17} />
            </div>
            <div>
              <span className="eyebrow">SYLLABUS</span>
              <h3>Summary</h3>
            </div>
          </div>
          <p>
            {course.syllabus ||
              "No syllabus summary found. Sync again after syllabus content is available."}
          </p>
          {course.syllabusSource && (
            <div className="syllabus-source">
              <span /> Found in {course.syllabusSource}
            </div>
          )}
          <div className="syllabus-note">
            AI-generated summary. Refer to the original material for full
            course requirements.
          </div>
        </aside>
      </div>
    </div>
  );
}

function TaskRow({
  item,
  courseTitle,
  onToggle,
}: {
  item: ChecklistItem;
  courseTitle: string;
  onToggle: (completed: boolean) => void;
}) {
  return (
    <div className={`task-row ${item.completed ? "task-completed" : ""}`}>
      <button
        className="task-check"
        onClick={() => onToggle(!item.completed)}
        aria-label={
          item.completed
            ? `Mark ${item.title} incomplete`
            : `Mark ${item.title} complete`
        }
      >
        {item.completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
      </button>
      <div className="task-info">
        <strong>{item.title}</strong>
        <div className="task-meta">
          <span className="task-course">{courseTitle}</span>
          <span className="meta-separator">·</span>
          <span>{item.source}</span>
          {item.details && (
            <>
              <span className="meta-separator">·</span>
              <span className="task-detail">{item.details}</span>
            </>
          )}
        </div>
      </div>
      <div className="task-right">
        <span className={`effort-pill effort-${effortBand(item.effort)}`}>
          <span className="effort-dot" /> {item.effort}/10
        </span>
        <span className={`due-date ${!item.dueDate ? "no-date" : ""}`}>
          {item.dueDate ? dueLabel(item.dueDate) : "No date"}
        </span>
      </div>
    </div>
  );
}

function SettingsPage({
  onError,
  onSaved,
}: {
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    schoologyKey: "",
    schoologySecret: "",
    openAiKey: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    let active = true;
    apiRequest<AppSettings>("/api/settings")
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch((loadError: unknown) => {
        if (active) onError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [onError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      onError("Your new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          schoologyKey: form.schoologyKey || undefined,
          schoologySecret: form.schoologySecret || undefined,
          openAiKey: form.openAiKey || undefined,
          currentPassword: form.currentPassword || undefined,
          newPassword: form.newPassword || undefined,
        }),
      });
      setForm({
        schoologyKey: "",
        schoologySecret: "",
        openAiKey: "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      onSaved();
      setSaved(true);
    } catch (saveError) {
      onError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-title-block">
        <span className="eyebrow">ACCOUNT</span>
        <h1>Settings</h1>
        <p className="page-subtitle">
          Update your Schoology and OpenAI keys or change your app password.
        </p>
      </div>
      <form className="settings-form" onSubmit={submit}>
        <section className="settings-card">
          <div className="settings-card-heading">
            <div className="settings-icon green">
              <BookOpen size={18} />
            </div>
            <div>
              <h2>Schoology connection</h2>
              <p>Update your API consumer credentials.</p>
            </div>
            <StatusBadge configured={settings?.schoologyConfigured ?? false} />
          </div>
          <div className="settings-fields">
            <div className="field-group">
              <label htmlFor="settings-schoology-key">Consumer key</label>
              <input
                id="settings-schoology-key"
                autoComplete="off"
                value={form.schoologyKey}
                onChange={(event) =>
                  setForm({ ...form, schoologyKey: event.target.value })
                }
                placeholder="Leave blank to keep your current key"
              />
            </div>
            <div className="field-group">
              <label htmlFor="settings-schoology-secret">Consumer secret</label>
              <input
                id="settings-schoology-secret"
                type="password"
                autoComplete="new-password"
                value={form.schoologySecret}
                onChange={(event) =>
                  setForm({ ...form, schoologySecret: event.target.value })
                }
                placeholder="Leave blank to keep your current secret"
              />
              <a
                className="field-hint field-link"
                href="https://Schoology.schoology.com/api"
                target="_blank"
                rel="noreferrer"
              >
                Manage keys at Schoology <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-card-heading">
            <div className="settings-icon lavender">
              <Sparkles size={18} />
            </div>
            <div>
              <h2>Course analysis</h2>
              <p>Used to find dates in course materials and estimate task effort.</p>
            </div>
            <StatusBadge configured={settings?.openAiConfigured ?? false} />
          </div>
          <div className="settings-fields single-field">
            <div className="field-group">
              <label htmlFor="settings-openai-key">OpenAI API key</label>
              <input
                id="settings-openai-key"
                type="password"
                autoComplete="new-password"
                value={form.openAiKey}
                onChange={(event) =>
                  setForm({ ...form, openAiKey: event.target.value })
                }
                placeholder="Leave blank to keep your current key"
              />
              <span className="field-hint">
                Current analysis model: {settings?.model ?? "Loading…"}
              </span>
            </div>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-card-heading">
            <div className="settings-icon peach">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2>App password</h2>
              <p>Change the password used to unlock this planner.</p>
            </div>
          </div>
          <div className="settings-fields">
            <div className="field-group">
              <label htmlFor="current-password">Current password</label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(event) =>
                  setForm({ ...form, currentPassword: event.target.value })
                }
                placeholder="Required to set a new password"
              />
            </div>
            <div className="field-group">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={form.newPassword}
                onChange={(event) =>
                  setForm({ ...form, newPassword: event.target.value })
                }
                placeholder="At least 8 characters"
              />
            </div>
            <div className="field-group">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={form.confirmPassword}
                onChange={(event) =>
                  setForm({ ...form, confirmPassword: event.target.value })
                }
                placeholder="Enter your new password again"
              />
            </div>
          </div>
        </section>
        <div className="settings-actions">
          {saved && (
            <span className="saved-message">
              <Check size={15} /> Changes saved
            </span>
          )}
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
        <p className="settings-footnote">
          <ShieldCheck size={14} /> API keys are encrypted on the server and
          never shown after saving.
        </p>
      </form>
    </>
  );
}

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span className={`status-badge ${configured ? "status-ready" : ""}`}>
      <span /> {configured ? "Connected" : "Not set"}
    </span>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="form-error">
      <AlertCircle size={15} /> {children}
    </div>
  );
}

function ListIcon() {
  return <CheckCircle2 size={14} />;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function formattedToday(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function dueLabel(dateValue: string): string {
  const due = new Date(`${dateValue}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due.getTime() === today.getTime()) return "Today";
  if (due.getTime() === tomorrow.getTime()) return "Tomorrow";
  return due.toLocaleDateString([], { month: "short", day: "numeric" });
}

function effortBand(effort: number): "easy" | "medium" | "high" {
  if (effort <= 3) return "easy";
  if (effort <= 6) return "medium";
  return "high";
}

export default App;
