/** @jsxImportSource @opentui/solid */
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { MouseEvent, TextRenderable } from "@opentui/core";
import { Portal, useTerminalDimensions } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";

type Tab = ReturnType<Context["ui"]["tabs"]["list"]>[number];
type Row = { readonly tab: Tab; readonly activity: number };
type Group = {
  readonly key: string;
  readonly name: string;
  readonly hint?: string;
  readonly rows: Row[];
  readonly activity: number;
};
type View = {
  readonly open: boolean;
  readonly grouping: boolean;
  readonly collapsed?: Readonly<Record<string, boolean>>;
};
type MenuTarget = { readonly tab: Tab; readonly x: number; readonly y: number };

function identify(context: Context, sessionID: string) {
  const session = context.data.session.get(sessionID);
  if (!session) return;
  const project = session.projectID
    ? context.data.project.get(session.projectID)
    : undefined;
  // Sessions outside a repository share the root project, so group those by directory instead.
  const loose = !project || project.canonical === "/";
  const root = loose ? session.location.directory : project.canonical;
  return {
    key: loose ? `dir:${root}` : `project:${project.id}`,
    name: project?.name || path.basename(root),
    place: path.dirname(root),
    session,
  };
}

// `time.updated` also moves on non-work events such as a service restart; `idle` is when the agent last finished.
function activity(
  tab: Tab,
  time: { readonly created: number; readonly idle?: number } | undefined,
) {
  if (tab.busy) return Number.MAX_SAFE_INTEGER;
  return time ? Math.max(time.created, time.idle ?? 0) : 0;
}

function group(context: Context) {
  const groups = new Map<
    string,
    { key: string; name: string; place?: string; rows: Row[]; activity: number }
  >();
  let complete = true;
  for (const tab of context.ui.tabs.list()) {
    const id = identify(context, tab.sessionID);
    if (!id) complete = false;
    const key = id?.key ?? "unknown";
    const target = groups.get(key) ?? {
      key,
      name: id?.name ?? "Loading",
      place: id?.place,
      rows: [],
      activity: 0,
    };
    groups.set(key, target);
    const row = { tab, activity: activity(tab, id?.session.time) };
    target.rows.push(row);
    target.activity = Math.max(target.activity, row.activity);
  }
  const names = new Map<string, number>();
  for (const item of groups.values())
    names.set(item.name, (names.get(item.name) ?? 0) + 1);
  const sorted: Group[] = [...groups.values()]
    .map((item) => ({
      key: item.key,
      name: item.name,
      hint:
        (names.get(item.name) ?? 0) > 1 && item.place
          ? context.ui.format.path(item.place)
          : undefined,
      rows: item.rows.toSorted((left, right) => right.activity - left.activity),
      activity: item.activity,
    }))
    .toSorted((left, right) => right.activity - left.activity);
  return { groups: sorted, complete };
}

function ago(time: number, now: number) {
  if (time === Number.MAX_SAFE_INTEGER) return "now";
  if (!time) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function useNow() {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));
  return now;
}

function Controller(props: {
  context: Context;
  view: View;
  toggleGrouping: () => void;
}) {
  const context = props.context;
  const requested = new Set<string>();
  const grouped = createMemo(() => group(context));

  createEffect(() => {
    for (const tab of context.ui.tabs.list()) {
      const session = context.data.session.get(tab.sessionID);
      if (!session && !requested.has(tab.sessionID)) {
        requested.add(tab.sessionID);
        void context.data.session.sync(tab.sessionID);
      }
      if (
        session?.projectID &&
        !context.data.project.get(session.projectID) &&
        !requested.has(session.projectID)
      ) {
        requested.add(session.projectID);
        void context.data.project.sync();
      }
    }
  });

  createEffect(() => {
    if (!props.view.grouping || !context.ui.tabs.enabled()) return;
    const { groups, complete } = grouped();
    if (!complete) return;
    const current = context.ui.tabs.list().map((tab) => tab.sessionID);
    const target = groups.flatMap((item) =>
      item.rows.map((row) => row.tab.sessionID),
    );
    if (target.every((sessionID, index) => current[index] === sessionID))
      return;
    queueMicrotask(() =>
      target.forEach((sessionID, index) =>
        context.ui.tabs.move(sessionID, index),
      ),
    );
  });

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "project-tabs.grouping.toggle",
        title: props.view.grouping
          ? "Stop sorting tabs by project"
          : "Sort tabs by project",
        group: "Tabs",
        palette: true,
        run: props.toggleGrouping,
      },
    ],
  }));

  return null;
}

// Mirrors OpenTUI's MouseButton values so the plugin needs no runtime OpenTUI import.
const LEFT = 0;
const RIGHT = 2;

// Acts on release only when the same button went down on the same element, so a menu opened by
// a right-click never receives the release.
function clickable(handlers: {
  left?: (event: MouseEvent) => void;
  right?: (event: MouseEvent) => void;
}) {
  let pressed: number | undefined;
  return {
    onMouseDown(event: MouseEvent) {
      pressed = event.button;
      event.preventDefault();
      event.stopPropagation();
    },
    onMouseUp(event: MouseEvent) {
      const button = pressed;
      pressed = undefined;
      event.preventDefault();
      event.stopPropagation();
      if (button !== event.button) return;
      if (button === LEFT) handlers.left?.(event);
      if (button === RIGHT) handlers.right?.(event);
    },
    onMouseDragEnd() {
      pressed = undefined;
    },
  };
}

function glyph(theme: Context["theme"], tab: Tab) {
  if (tab.attention)
    return { char: "!", fg: theme.text.feedback.warning.base, rank: 4 };
  if (tab.unread === "error")
    return { char: "●", fg: theme.text.feedback.error.base, rank: 3 };
  if (tab.busy)
    return { char: "●", fg: theme.text.feedback.info.base, rank: 2 };
  if (tab.unread === "activity")
    return { char: "●", fg: theme.text.base, rank: 1 };
  return { char: "•", fg: theme.text.muted, rank: 0 };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type MenuItem = {
  readonly title: string;
  /** Needs a second click, the way OpenCode confirms deletes in its lists. */
  readonly confirm?: boolean;
  readonly armed?: boolean;
  readonly run: () => void;
};

const MENU_MIN_WIDTH = 20;
const MENU_MAX_WIDTH = 50;
const CONFIRM_DELETE = "Click again to delete";

// Mirrors OpenCode's own tab context menu: a dropdown under the cursor that floats above the screen
// through a portal and closes on Escape, Ctrl+C or a click outside.
function TabMenu(props: {
  context: Context;
  target: MenuTarget;
  onDismiss: () => void;
}) {
  const context = props.context;
  const theme = context.theme;
  const terminal = useTerminalDimensions();
  const sessionID = props.target.tab.sessionID;
  const [hovered, setHovered] = createSignal<number>();
  const [armed, setArmed] = createSignal(false);

  const fail = (action: string) => (error: unknown) =>
    context.ui.toast.show({
      variant: "error",
      message: `Couldn't ${action} session: ${message(error)}`,
    });
  const rename = async () => {
    const title = (
      await context.ui.dialog.prompt({
        title: "Rename session",
        placeholder: "Session title",
        value: props.target.tab.title,
      })
    )?.trim();
    if (!title || title === props.target.tab.title) return;
    await context.client.session
      .update({ sessionID, title })
      .catch(fail("rename"));
  };
  const copy = () => {
    const copied = context.renderer.copyToClipboardOSC52(sessionID);
    context.ui.toast.show(
      copied
        ? { message: "Session ID copied to clipboard", variant: "info" }
        : { message: "This terminal doesn't allow copying", variant: "error" },
    );
  };
  const remove = () =>
    context.client.session
      .remove({ sessionID })
      .then(() => void context.ui.tabs.close(sessionID))
      .catch(fail("delete"));

  const items = createMemo<MenuItem[]>(() => [
    { title: "New session", run: () => context.keymap.dispatch("session.new") },
    { title: "Rename", run: () => void rename() },
    { title: "Copy session ID", run: copy },
    ...(context.ui.tabs.enabled()
      ? [{ title: "Close", run: () => void context.ui.tabs.close(sessionID) }]
      : []),
    {
      title: armed() ? CONFIRM_DELETE : "Delete",
      confirm: true,
      armed: armed(),
      run: () => void remove(),
    },
  ]);
  const activate = (index: number) => {
    const item = items()[index];
    if (!item) return;
    if (item.confirm && !armed()) return void setArmed(true);
    props.onDismiss();
    item.run();
  };
  const width = () =>
    Math.min(
      terminal().width,
      Math.max(
        MENU_MIN_WIDTH,
        ...[...items().map((item) => item.title), CONFIRM_DELETE].map((title) =>
          Math.min(MENU_MAX_WIDTH, title.length + 2),
        ),
      ),
    );
  const height = () => Math.min(items().length, terminal().height);

  onCleanup(context.keymap.mode.push("menu"));
  context.keymap.layer(() => ({
    mode: "menu",
    commands: [
      {
        bind: "escape,ctrl+c",
        title: "Close tab menu",
        group: "Tabs",
        run: props.onDismiss,
      },
    ],
  }));

  return (
    <Portal
      ref={(element) =>
        Object.assign(element, {
          position: "absolute",
          left: 0,
          top: 0,
          zIndex: 2500,
        })
      }
    >
      <box
        position="absolute"
        left={0}
        top={0}
        zIndex={2500}
        width={terminal().width}
        height={terminal().height}
        onMouseDown={(event: MouseEvent) => {
          props.onDismiss();
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <box
          position="absolute"
          flexDirection="column"
          width={width()}
          height={height()}
          left={Math.max(
            0,
            Math.min(props.target.x, terminal().width - width()),
          )}
          top={Math.max(
            0,
            Math.min(props.target.y + 1, terminal().height - height()),
          )}
          backgroundColor={theme.background.raised.base}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === RIGHT) props.onDismiss();
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <For each={items()}>
            {(item, index) => (
              <box
                width="100%"
                height={1}
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  item.armed
                    ? theme.background.action.destructive.focused
                    : hovered() === index()
                      ? theme.background.raised.high
                      : undefined
                }
                onMouseOver={() => setHovered(index())}
                onMouseOut={() => setHovered(undefined)}
                onMouseUp={(event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.button === RIGHT) return;
                  activate(index());
                }}
              >
                <text
                  selectable={false}
                  truncate
                  fg={
                    item.armed
                      ? theme.text.action.destructive.focused
                      : theme.text.base
                  }
                >
                  {item.title}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </Portal>
  );
}
// Same timing and separator as OpenCode's own tab titles: wait, then scroll one cell per step
// through one full loop of the title.
const MARQUEE_DELAY = 600;
const MARQUEE_STEP = 80;
const MARQUEE_SEPARATOR = " · ";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cells(text: string) {
  return Bun.stringWidth(text);
}

// The part of the endlessly repeating "title · title · " that is visible `offset` cells in,
// split into runs so the separator can be dimmed.
function marquee(text: string, room: number, offset: number) {
  const parts = [
    ...Array.from(graphemes.segment(text), (part) => ({
      value: part.segment,
      separator: false,
    })),
    ...Array.from(graphemes.segment(MARQUEE_SEPARATOR), (part) => ({
      value: part.segment,
      separator: part.segment === "·",
    })),
  ];
  const loop = [...parts, ...parts];
  const shift = offset % cells(text + MARQUEE_SEPARATOR);
  let start = 0;
  for (let skipped = 0; start < loop.length && skipped < shift; start++)
    skipped += cells(loop[start].value);
  const runs: { text: string; separator: boolean }[] = [];
  for (let index = start, used = 0; index < loop.length; index++) {
    const part = loop[index];
    used += cells(part.value);
    if (used > room) break;
    const last = runs.at(-1);
    if (last?.separator === part.separator) last.text += part.value;
    else runs.push({ text: part.value, separator: part.separator });
  }
  return runs;
}

function useMarquee() {
  const [offset, setOffset] = createSignal(0);
  const [room, setRoom] = createSignal(0);
  let delay: ReturnType<typeof setTimeout> | undefined;
  let step: ReturnType<typeof setInterval> | undefined;
  let leaving: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(step);
    running = false;
    setOffset(0);
  };
  // Moving between a row's children fires out-then-over, so leaving waits a tick to be cancelled.
  const enter = (text: string, width: number) => {
    clearTimeout(leaving);
    if (running || cells(text) <= width) return;
    running = true;
    setRoom(width);
    const cycle = cells(text + MARQUEE_SEPARATOR);
    delay = setTimeout(() => {
      setOffset(1);
      step = setInterval(() => {
        if (offset() + 1 < cycle) setOffset(offset() + 1);
        else {
          clearInterval(step);
          setOffset(0);
        }
      }, MARQUEE_STEP);
    }, MARQUEE_DELAY);
  };
  const leave = () => {
    clearTimeout(leaving);
    leaving = setTimeout(stop);
  };
  onCleanup(() => {
    clearTimeout(leaving);
    stop();
  });
  return { offset, room, enter, leave };
}

function TabRow(props: {
  context: Context;
  row: Row;
  now: number;
  active: boolean;
  menu: boolean;
  onSelect: () => void;
  onMenu: (event: MouseEvent) => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const status = () => glyph(theme, props.row.tab);
  const label = () => props.row.tab.title || "Untitled";
  const scroll = useMarquee();
  const visible = createMemo(() =>
    scroll.offset() > 0 ? marquee(label(), scroll.room(), scroll.offset()) : [],
  );
  let title: TextRenderable | undefined;

  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={2}
      backgroundColor={
        hovered() || props.menu ? theme.background.raised.high : undefined
      }
      onMouseOver={() => {
        setHovered(true);
        scroll.enter(label(), title?.width ?? 0);
      }}
      onMouseOut={() => {
        setHovered(false);
        scroll.leave();
      }}
      {...clickable({ left: props.onSelect, right: props.onMenu })}
    >
      <text fg={status().fg} flexShrink={0}>
        {status().char}
      </text>
      <text
        ref={title}
        fg={props.active || hovered() ? theme.text.base : theme.text.muted}
        wrapMode="none"
        truncate={visible().length === 0}
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
      >
        <Show when={visible().length > 0} fallback={label()}>
          <For each={visible()}>
            {(run) => (
              <span
                style={{
                  fg: run.separator ? theme.text.muted : theme.text.base,
                }}
              >
                {run.text}
              </span>
            )}
          </For>
        </Show>
      </text>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        {ago(props.row.activity, props.now)}
      </text>
    </box>
  );
}

function GroupHeader(props: {
  context: Context;
  item: Group;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const strongest = () =>
    props.item.rows
      .map((row) => glyph(theme, row.tab))
      .reduce((best, next) => (next.rank > best.rank ? next : best));

  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={hovered() ? theme.background.raised.high : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      {...clickable({ left: props.onToggle })}
    >
      <text fg={theme.text.muted} flexShrink={0}>
        {props.collapsed ? "▶" : "▼"}
      </text>
      <text
        fg={theme.text.base}
        wrapMode="none"
        truncate
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
      >
        <b>{props.item.name}</b>
        <Show when={props.item.hint}>
          <span style={{ fg: theme.text.muted }}> {props.item.hint}</span>
        </Show>
        <Show when={props.collapsed}>
          <span style={{ fg: theme.text.muted }}>
            {" "}
            ({props.item.rows.length})
          </span>
        </Show>
      </text>
      <Show when={props.collapsed && strongest().rank > 0}>
        <text fg={strongest().fg} flexShrink={0}>
          {strongest().char}
        </text>
      </Show>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        {ago(props.item.activity, props.now)}
      </text>
    </box>
  );
}

function ProjectTabs(props: {
  context: Context;
  view: View;
  toggleOpen: () => void;
  toggleGroup: (key: string) => void;
}) {
  const context = props.context;
  const theme = context.theme;
  const now = useNow();
  const grouped = createMemo(() => group(context));
  const [menu, setMenu] = createSignal<MenuTarget>();
  // With session tabs turned off, tabs.list() still returns the saved tabs but focus() refuses, so navigate directly.
  const select = (sessionID: string) => {
    if (context.ui.tabs.focus(sessionID)) return;
    context.ui.router.navigate({ type: "session", sessionID });
  };
  const active = (tab: Tab) => {
    if (context.ui.tabs.enabled()) return tab.active;
    const route = context.ui.router.current();
    return (
      route.type === "session" &&
      context.data.session.root(route.sessionID) === tab.sessionID
    );
  };

  return (
    <Show when={grouped().groups.length > 0}>
      <box flexDirection="column">
        <box
          flexDirection="row"
          gap={1}
          {...clickable({ left: props.toggleOpen })}
        >
          <text fg={theme.text.base}>{props.view.open ? "▼" : "▶"}</text>
          <text fg={theme.text.base}>
            <b>Tabs</b>
            <span style={{ fg: theme.text.muted }}> by project</span>
          </text>
        </box>
        <Show when={props.view.open}>
          <For each={grouped().groups}>
            {(item) => (
              <box flexDirection="column" paddingTop={1}>
                <GroupHeader
                  context={context}
                  item={item}
                  now={now()}
                  collapsed={props.view.collapsed?.[item.key] === true}
                  onToggle={() => props.toggleGroup(item.key)}
                />
                <Show when={props.view.collapsed?.[item.key] !== true}>
                  <For each={item.rows}>
                    {(row) => (
                      <TabRow
                        context={context}
                        row={row}
                        now={now()}
                        active={active(row.tab)}
                        menu={menu()?.tab.sessionID === row.tab.sessionID}
                        onSelect={() => select(row.tab.sessionID)}
                        onMenu={(event) =>
                          setMenu({ tab: row.tab, x: event.x, y: event.y })
                        }
                      />
                    )}
                  </For>
                </Show>
              </box>
            )}
          </For>
        </Show>
        <Show when={menu()} keyed>
          {(target: MenuTarget) => (
            <TabMenu
              context={context}
              target={target}
              onDismiss={() => setMenu(undefined)}
            />
          )}
        </Show>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "kris.project-tabs",
  setup(context) {
    const [view, updateView] = context.storage.store<{
      open: boolean;
      grouping: boolean;
      collapsed?: Record<string, boolean>;
    }>("view", {
      initial: { open: true, grouping: true, collapsed: {} },
    });
    const toggleOpen = () =>
      void updateView((draft) => void (draft.open = !draft.open));
    const toggleGrouping = () =>
      void updateView((draft) => void (draft.grouping = !draft.grouping));
    const toggleGroup = (key: string) =>
      void updateView((draft) => {
        draft.collapsed ??= {};
        draft.collapsed[key] = !draft.collapsed[key];
      });
    void context.data.project.sync();

    context.ui.slot({
      append: "app",
      render: () => (
        <Controller
          context={context}
          view={view}
          toggleGrouping={toggleGrouping}
        />
      ),
    });
    context.ui.slot({
      prepend: "sidebar.content",
      render: () => (
        <ProjectTabs
          context={context}
          view={view}
          toggleOpen={toggleOpen}
          toggleGroup={toggleGroup}
        />
      ),
    });
  },
});
