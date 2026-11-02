export interface ChecklistItem {
  id: string;
  title: string;
  dueDate: string | null;
  effort: number;
  details: string;
  source: string;
  sourceId: string;
  sourceType: "assignment" | "upcoming" | "material";
  completed: boolean;
}

export interface Course {
  id: string;
  title: string;
  courseCode?: string;
  syllabus: string | null;
  syllabusSource: string | null;
  checklist: ChecklistItem[];
}

export interface DashboardData {
  syncedAt: string | null;
  courses: Course[];
}

export interface AppSettings {
  schoologyConfigured: boolean;
  openAiConfigured: boolean;
  model: string;
}

export interface SyncProgress {
  active: boolean;
  stage: "idle" | "schoology" | "analysis" | "saving" | "complete" | "error";
  message: string;
  updatedAt: string;
}
