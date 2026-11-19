import { openDB } from "idb";
import { sanitizeProject, type Project } from "../model/project";

const DB_NAME = "floor-plan-cad";
const STORE = "case";

type CaseRecord = {
  project: Project;
  image: Blob | null;
  savedAt: number;
};

function database() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  });
}

export async function saveCase(project: Project, image: Blob | null): Promise<void> {
  const db = await database();
  const record: CaseRecord = { project, image, savedAt: Date.now() };
  await db.put(STORE, record, "current");
}

export async function loadCase(): Promise<CaseRecord | null> {
  const db = await database();
  const value: unknown = await db.get(STORE, "current");
  if (!value || typeof value !== "object") return null;
  const record = value as CaseRecord;
  const project = sanitizeProject(record.project);
  if (!project) return null;
  const image = record.image instanceof Blob ? record.image : null;
  return { project, image, savedAt: typeof record.savedAt === "number" ? record.savedAt : 0 };
}

export async function clearCase(): Promise<void> {
  const db = await database();
  await db.delete(STORE, "current");
}
