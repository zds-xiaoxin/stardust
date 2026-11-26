import { useSidebarCategories } from "~/hooks/useSidebarCategories";
import { useUiText } from "~/i18n/useUiText";

import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { openCommandPalette } from "../../commandPaletteBus";
import {
  type DraftId,
  composerDraftHasUserContent,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import {
  carryDraftCategory,
  takeCarriedDraftCategory,
  setThreadCategory,
  threadCategoryById,
} from "../../threadCategories";
import type { Project } from "../../types";
import { draftFolderSections, folderDisplayName } from "./draftFolderSections";
import { ProjectFavicon } from "../ProjectFavicon";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";

const compactPath = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");

/**
 * The draft's "where does this go" chip: the sidebar category (optional, otherwise the
 * title rules decide) and the folder the assistant works in.
 */
export function DraftWorkspaceNotice({
  draftId,
  project,
  workspacePath,
  canChange,
  workspaceControl,
  environmentControl,
}: {
  draftId: DraftId;
  project: Project;
  workspacePath: string;
  canChange: () => boolean;
  workspaceControl?: ReactNode;
  environmentControl?: ReactNode;
}) {
  const uiText = useUiText();
  const projects = useProjects();
  const threads = useThreadShells();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const { environments } = useEnvironments();
  const { overrides, categories, groups } = useSidebarCategories();
  const openProjectDraft = useNewThreadHandler();
  const session = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"folders" | "categories">("folders");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<"all" | "temporary" | null>(null);

  const scratchRootFor = (environmentId: string) =>
    environments.find((e) => e.environmentId === environmentId)?.serverConfig?.scratchWorkspaceRoot;
  const isScratch = isScratchProject(project, scratchRootFor(project.environmentId));
  const folderName = folderDisplayName(project, isScratch);
  const threadKey = session
    ? scopedThreadKey(scopeThreadRef(session.environmentId, session.threadId))
    : null;
  const manualCategory = threadKey ? overrides[threadKey] : undefined;
  const categoryLabel = manualCategory
    ? threadCategoryById(manualCategory, categories).label
    : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- one-shot handoff of a category picked on the empty draft this one replaced
  useEffect(() => {
    if (!threadKey || !session) return;
    const carried = takeCarriedDraftCategory(`${session.environmentId}:${session.projectId}`);
    if (carried && !overrides[threadKey]) setThreadCategory(threadKey, carried);
  }, [threadKey, session, overrides]);

  const sections = draftFolderSections({
    projects,
    threads,
    query,
    isScratch: (candidate) => isScratchProject(candidate, scratchRootFor(candidate.environmentId)),
  });

  const chooseCategory = (categoryId: string | null) => {
    if (!threadKey) return;
    if (!setThreadCategory(threadKey, categoryId))
      toastManager.add({
        type: "error",
        title: uiText("Could not save the category. Check available local storage."),
      });
    setView("folders");
  };

  const chooseFolder = async (target: Project) => {
    setOpen(false);
    if (!canChange()) return;
    const store = useComposerDraftStore.getState();
    const current = store.getDraftSession(draftId);
    if (!current || current.promotedTo) return;
    if (current.projectId === target.id && current.environmentId === target.environmentId) return;
    const ref = scopeProjectRef(target.environmentId, target.id);
    try {
      // An empty draft opens the target project's own draft, so no project loses its draft.
      if (!composerDraftHasUserContent(store.getComposerDraft(draftId))) {
        if (manualCategory) {
          carryDraftCategory(`${target.environmentId}:${target.id}`, manualCategory);
        }
        await openProjectDraft(ref);
        return;
      }
      store.setLogicalProjectDraftThreadId(
        deriveLogicalProjectKeyFromSettings(target, settings),
        ref,
        draftId,
      );
    } catch {
      toastManager.add({ type: "error", title: uiText("Could not switch folders. Try again.") });
    }
  };

  const folderRow = (candidate: Project) => {
    const selected =
      candidate.id === project.id && candidate.environmentId === project.environmentId;
    const scratch = isScratchProject(candidate, scratchRootFor(candidate.environmentId));
    const icon = candidate.projectIcon;
    const hasImage =
      candidate.faviconPath || (icon && icon.kind !== "emoji" && icon.kind !== "monogram");
    return (
      <button
        key={`${candidate.environmentId}:${candidate.id}`}
        type="button"
        role="option"
        aria-selected={selected}
        data-draft-folder-row
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
        onClick={() => void chooseFolder(candidate)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-primary">
          {selected ? <CheckIcon className="size-3.5" /> : null}
        </span>
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-muted">
          {hasImage ? (
            <ProjectFavicon project={candidate} className="size-3.5" />
          ) : (
            <FolderIcon className="size-3.5 text-muted-foreground" strokeWidth={1.6} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {folderDisplayName(candidate, scratch)}
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {scratch
              ? uiText("Temporary thread · Each task has its own folder")
              : compactPath(candidate.workspaceRoot)}
          </span>
        </span>
      </button>
    );
  };

  const disclosure = (key: "all" | "temporary", label: string, rows: readonly Project[]) =>
    rows.length ? (
      <div>
        <button
          type="button"
          aria-expanded={expanded === key}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
          onClick={() => setExpanded((value) => (value === key ? null : key))}
        >
          <span className="size-4 shrink-0" />
          <span className="flex-1">
            {uiText("{label} ({count})", { label, count: rows.length })}
          </span>
          <ChevronRightIcon
            className={`size-3.5 transition-transform ${expanded === key ? "rotate-90" : ""}`}
          />
        </button>
        {expanded === key ? (
          <div className="max-h-56 overflow-y-auto">{rows.map((row) => folderRow(row))}</div>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      data-draft-workspace-notice
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next && !canChange()) return;
          setOpen(next);
          if (!next) {
            setView("folders");
            setQuery("");
            setExpanded(null);
          }
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={uiText("Location: {folder}", {
                folder: [categoryLabel, folderName, compactPath(workspacePath)]
                  .filter(Boolean)
                  .join(" · "),
              })}
              className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground hover:bg-muted data-[popup-open]:bg-muted"
            />
          }
        >
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.6} />
          <span className="max-w-56 truncate">
            {categoryLabel ? (
              <span className="text-muted-foreground">{categoryLabel} · </span>
            ) : null}
            {folderName}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" padding="none" className="w-[22rem]">
          {view === "categories" ? (
            <div className="p-2" data-draft-category-view>
              <div className="mb-1 flex items-center gap-1">
                <button
                  type="button"
                  aria-label={uiText("Back")}
                  className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
                  onClick={() => setView("folders")}
                >
                  <ChevronLeftIcon className="size-4" />
                </button>
                <span className="text-sm font-medium">{uiText("Category for this task")}</span>
              </div>
              <div className="max-h-[min(50vh,420px)] space-y-2.5 overflow-y-auto px-1 pb-1">
                <button
                  type="button"
                  aria-pressed={!manualCategory}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
                  onClick={() => chooseCategory(null)}
                >
                  {uiText("Automatic filing")}
                  <span className="block text-2xs text-muted-foreground">
                    {uiText("File this thread automatically by title")}
                  </span>
                </button>
                {groups.map((group) => (
                  <section key={group} aria-label={group}>
                    {group ? (
                      <h3 className="mb-1 px-1 text-2xs text-muted-foreground">{group}</h3>
                    ) : null}
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {categories
                        .filter((category) => (category.group ?? "") === group)
                        .map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            aria-pressed={manualCategory === category.id}
                            className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                            onClick={() => chooseCategory(category.id)}
                          >
                            {category.label}
                          </button>
                        ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-1.5" data-draft-folder-view>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent"
                onClick={() => setView("categories")}
                disabled={!threadKey}
              >
                <span className="size-4 shrink-0" />
                <span className="flex-1 text-sm">{uiText("Categories")}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {categoryLabel ?? uiText("Automatic filing")}
                </span>
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              </button>
              <div className="mx-2 my-1 h-px bg-border" />
              <label className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-muted-foreground">
                <SearchIcon className="size-3.5" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={uiText("Search folders")}
                  aria-label={uiText("Search folders")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              <div
                role="listbox"
                aria-label={uiText("Working folder")}
                className="max-h-[min(50vh,420px)] overflow-y-auto"
              >
                {query ? (
                  sections.matches.length ? (
                    sections.matches.map((row) => folderRow(row))
                  ) : (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      {uiText("No matching folders")}
                    </p>
                  )
                ) : (
                  <>
                    <p className="px-3 pt-1.5 pb-0.5 text-2xs text-muted-foreground">
                      {uiText("Recently used")}
                    </p>
                    {sections.recent.map((row) => folderRow(row))}
                    {disclosure("all", uiText("All folders"), sections.all)}
                    {disclosure("temporary", uiText("Older temporary folders"), sections.temporary)}
                  </>
                )}
              </div>
              <div className="mx-2 my-1 h-px bg-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  openCommandPalette({ open: "add-project" });
                }}
              >
                <span className="size-4 shrink-0" />
                <FolderPlusIcon className="size-3.5" />
                {uiText("Add project")}
              </button>
            </div>
          )}
        </PopoverPopup>
      </Popover>
      {workspaceControl}
      {environmentControl}
    </div>
  );
}
