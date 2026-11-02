import OAuth from "oauth-1.0a";
import { createHash, createHmac, randomBytes } from "node:crypto";

const API_BASE = "https://api.schoology.com/v1";
const PAGE_SIZE = 200;
const MAX_REDIRECTS = 5;
const MAX_PAGES = 100;

export interface SchoologyCredentials {
  key: string;
  secret: string;
}

export interface SchoologyCourseData {
  id: string;
  title: string;
  courseCode?: string;
  section: Record<string, unknown>;
  assignments: Record<string, unknown>[];
  upcoming: Record<string, unknown>[];
  materials: Record<string, unknown>[];
}

export interface SchoologyData {
  user: Record<string, unknown>;
  courses: SchoologyCourseData[];
}

function makeOauth(credentials: SchoologyCredentials): OAuth {
  const oauth = new OAuth({
    consumer: { key: credentials.key, secret: credentials.secret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return createHmac("sha1", key).update(baseString).digest("base64");
    },
  });
  oauth.getNonce = () => randomBytes(32).toString("hex");
  oauth.getTimeStamp = () => Math.floor(Date.now() / 1000);
  return oauth;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function resourceList(
  payload: unknown,
  singularName: string,
): Record<string, unknown>[] {
  const data = asRecord(payload);
  const value = data[singularName] ?? data[`${singularName}s`];
  if (Array.isArray(value)) return value.map(asRecord);
  if (value && typeof value === "object") {
    const nested = asRecord(value)[singularName];
    if (Array.isArray(nested)) return nested.map(asRecord);
    if (singularName === "event") {
      const collections = Object.values(asRecord(value)).flatMap((entry) =>
        Array.isArray(entry) ? entry.map(asRecord) : [],
      );
      if (collections.length) return collections;
    }
    return [asRecord(value)];
  }
  if (singularName === "event" && data.upcoming !== undefined) {
    const upcoming = data.upcoming;
    if (Array.isArray(upcoming)) return upcoming.map(asRecord);
    if (upcoming && typeof upcoming === "object") {
      const collections = Object.values(asRecord(upcoming)).flatMap((entry) =>
        Array.isArray(entry) ? entry.map(asRecord) : [],
      );
      if (collections.length) return collections;
      return [asRecord(upcoming)];
    }
  }
  return [];
}

function paginationTotal(payload: unknown): number | undefined {
  const data = asRecord(payload);
  const values = [data.total, data.count, data.total_count];
  for (const value of values) {
    const total = typeof value === "number" ? value : Number(value);
    if (Number.isSafeInteger(total) && total >= 0) return total;
  }
  return undefined;
}

function getId(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return undefined;
}

export class SchoologyClient {
  private readonly oauth: OAuth;

  constructor(private readonly credentials: SchoologyCredentials) {
    this.oauth = makeOauth(credentials);
  }

  private async get(path: string): Promise<unknown> {
    const initialUrl = new URL(path.replace(/^\/+/, ""), `${API_BASE}/`);
    let url = initialUrl;
    let response: Response;

    for (let redirects = 0; ; redirects += 1) {
      const authorization = this.oauth.toHeader(
        this.oauth.authorize({ url: url.toString(), method: "GET" }),
      );
      response = await fetch(url, {
        headers: { ...authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
        redirect: "manual",
      });

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new Error(
          `Schoology redirected ${response.status} for ${path} without a Location header.`,
        );
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new Error(
          `Schoology exceeded ${MAX_REDIRECTS} redirects while requesting ${path}.`,
        );
      }

      const redirectUrl = new URL(location, url);
      if (
        redirectUrl.protocol !== "https:" ||
        redirectUrl.origin !== initialUrl.origin
      ) {
        throw new Error(
          `Schoology redirected ${path} to ${redirectUrl.origin}. For security, credentials are only sent to ${initialUrl.origin}; configure the Schoology API URL to the final HTTPS destination.`,
        );
      }
      url = redirectUrl;
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(
        `Schoology returned ${response.status} for ${path}: ${body || response.statusText}`,
      );
    }
    return response.json();
  }

  private async getAll(
    path: string,
    singularName: string,
    onProgress?: (message: string) => void,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    const seenPages = new Set<string>();
    let start = 0;
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await this.get(
        `${path}${separator}start=${start}&limit=${PAGE_SIZE}`,
      );
      const page = resourceList(payload, singularName);
      const total = paginationTotal(payload);
      if (page.length === 0) {
        if (total !== undefined && start < total) {
          throw new Error(
            `Schoology returned an empty ${singularName} page at offset ${start} of ${total} for ${path}.`,
          );
        }
        return results;
      }
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(page))
        .digest("hex");
      if (seenPages.has(fingerprint)) {
        throw new Error(
          `Schoology repeated the same ${singularName} page at offset ${start} for ${path}; stopping pagination. Check whether this endpoint supports start/limit parameters.`,
        );
      }
      seenPages.add(fingerprint);
      results.push(...page);
      onProgress?.(
        `Loaded ${results.length}${total === undefined ? "" : ` of ${total}`} ${singularName}s`,
      );
      start += page.length;
      if (total !== undefined ? start >= total : page.length < PAGE_SIZE) {
        return results;
      }
      if (pageNumber === MAX_PAGES) {
        throw new Error(
          `Schoology returned more than ${MAX_PAGES * PAGE_SIZE} ${singularName}s for ${path}; stopping to avoid an endless sync.`,
        );
      }
    }
    return results;
  }

  async fetchAllCourses(
    onProgress?: (message: string) => void,
  ): Promise<SchoologyData> {
    onProgress?.("Connecting to Schoology");
    const userResponse = asRecord(await this.get("/users/me"));
    const user = asRecord(userResponse.user ?? userResponse);
    const userId = getId(user.id);
    if (!userId) {
      throw new Error(
        "Schoology did not return a user ID for the connected account.",
      );
    }

    onProgress?.("Loading your course list");
    const sections = await this.getAll(
      `/users/${encodeURIComponent(userId)}/sections`,
      "section",
      onProgress,
    );
    onProgress?.("Loading your Schoology calendar");
    const upcoming = await this.getAll(
      `/users/${encodeURIComponent(userId)}/events`,
      "event",
      onProgress,
    );
    const courses: SchoologyCourseData[] = [];

    for (const [index, section] of sections.entries()) {
      const id = getId(section.id);
      if (!id) continue;
      onProgress?.(
        `Loading course ${index + 1} of ${sections.length}: ${getId(section.course_title) ?? getId(section.title) ?? "Course"}`,
      );
      const sectionPath = `/sections/${encodeURIComponent(id)}`;
      const courseId = getId(section.course_id) ?? id;
      const [sectionResponse, courseResponse, assignments, materials] =
        await Promise.all([
          this.get(sectionPath),
          this.get(`/courses/${encodeURIComponent(courseId)}`),
          this.getAll(`${sectionPath}/assignments`, "assignment"),
          this.getAll(`${sectionPath}/materials`, "material"),
        ]);
      const sectionDetail = asRecord(
        asRecord(sectionResponse).section ?? sectionResponse,
      );
      const courseDetail = asRecord(
        asRecord(courseResponse).course ?? courseResponse,
      );
      const courseTitle =
        getId(courseDetail.title) ??
        getId(courseDetail.course_title) ??
        getId(section.course_title) ??
        getId(section.title) ??
        getId(sectionDetail.course_title) ??
        getId(sectionDetail.title) ??
        "Untitled course";
      courses.push({
        id,
        title: courseTitle,
        courseCode:
          getId(courseDetail.course_code) ??
          getId(section.course_code) ??
          getId(sectionDetail.course_code) ??
          undefined,
        section: {
          ...courseDetail,
          ...sectionDetail,
          ...section,
          course_id: courseId,
        },
        assignments,
        upcoming: upcoming.filter((event) => {
          const eventSectionId = getId(event.section_id ?? event.sectionId);
          return !eventSectionId || eventSectionId === id;
        }),
        materials,
      });
    }

    return { user, courses };
  }
}
