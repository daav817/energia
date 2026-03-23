"use client";

import { FolderOpen, ChevronDown, ChevronRight, Inbox, Send, Trash2, Star, Plus, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export type Label = { id: string; name: string; type?: string; messagesUnread?: number; messagesTotal?: number };

export type FolderNode = {
  id: string;
  name: string;
  labelId?: string;
  children: FolderNode[];
  depth: number;
  unread?: number;
};

const SYSTEM_ICONS: Record<string, React.ReactNode> = {
  INBOX: <Inbox className="h-4 w-4 shrink-0" />,
  SENT: <Send className="h-4 w-4 shrink-0" />,
  TRASH: <Trash2 className="h-4 w-4 shrink-0" />,
  STARRED: <Star className="h-4 w-4 shrink-0" />,
};

export function buildFolderTree(labels: Label[]): FolderNode[] {
  const SYSTEM_IDS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD"];
  const systemOrder = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"];
  const result: FolderNode[] = [];

  for (const sid of systemOrder) {
    const label = labels.find((l) => l.id === sid);
    if (label) {
      let name = label.name.replace(/^\[Gmail\]\/?/i, "").trim() || sid.charAt(0) + sid.slice(1).toLowerCase();
      result.push({ id: label.id, name, labelId: label.id, children: [], depth: 0, unread: label.messagesUnread });
    }
  }

  const userLabels = labels.filter((l) => !SYSTEM_IDS.includes(l.id));
  const byPath = new Map<string, { labelId?: string; parts: string[]; unread?: number }>();
  for (const label of userLabels) {
    let name = label.name.replace(/^\[Gmail\]\/?/i, "").trim();
    if (!name) continue;
    const parts = name.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    byPath.set(parts.join("/"), { labelId: label.id, parts, unread: label.messagesUnread });
  }

  function addToTree(
    parent: FolderNode[],
    parts: string[],
    labelId: string,
    depth: number,
    prefix = "",
    unread?: number
  ): void {
    if (parts.length === 0) return;
    const [first, ...rest] = parts;
    const path = prefix ? `${prefix}/${first}` : first;
    const isLeaf = rest.length === 0;
    let node = parent.find((n) => n.name === first);
    if (!node) {
      node = {
        id: path,
        name: first,
        labelId: isLeaf ? labelId : undefined,
        children: [],
        depth,
        unread: isLeaf ? unread : undefined,
      };
      parent.push(node);
    } else if (isLeaf) {
      node.labelId = labelId;
      node.unread = unread;
    }
    if (rest.length > 0) {
      addToTree(node.children, rest, labelId, depth + 1, path, unread);
    }
  }

  const userRoot: FolderNode[] = [];
  Array.from(byPath.values()).forEach(({ labelId, parts, unread }) => {
    addToTree(userRoot, parts, labelId!, 0, "", unread);
  });

  // Roll up unread counts from children to parents so a parent folder's unread
  // reflects the total of all its subfolders.
  const rollupUnread = (node: FolderNode): number => {
    let total = node.unread ?? 0;
    for (const child of node.children) {
      total += rollupUnread(child);
    }
    node.unread = total > 0 ? total : undefined;
    return node.unread ?? 0;
  };

  result.forEach((n) => rollupUnread(n));
  userRoot.forEach((n) => rollupUnread(n));

  userRoot.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return [...result, ...userRoot];
}

type FolderTreeProps = {
  nodes: FolderNode[];
  selectedLabel: string;
  expanded: Set<string>;
  onSelect: (labelId: string) => void;
  onToggleExpand: (id: string) => void;
  onDelete?: (labelId: string, name: string) => void;
  onCreateFolder?: () => void;
};

const SYSTEM_IDS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD"];

export function FolderTree({
  nodes,
  selectedLabel,
  expanded,
  onSelect,
  onToggleExpand,
  onDelete,
  onCreateFolder,
}: FolderTreeProps) {
  return (
    <div className="space-y-0.5">
      {onCreateFolder && (
        <Tooltip content="Create new folder">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={onCreateFolder}>
            <Plus className="h-4 w-4" />
            New folder
          </Button>
        </Tooltip>
      )}
      {nodes.map((node) => (
        <FolderTreeNode
          key={node.id}
          node={node}
          selectedLabel={selectedLabel}
          expanded={expanded}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function FolderTreeNode({
  node,
  selectedLabel,
  expanded,
  onSelect,
  onToggleExpand,
  onDelete,
}: {
  node: FolderNode;
  selectedLabel: string;
  expanded: Set<string>;
  onSelect: (labelId: string) => void;
  onToggleExpand: (id: string) => void;
  onDelete?: (labelId: string, name: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = node.labelId === selectedLabel;
  const canDelete = node.labelId && !SYSTEM_IDS.includes(node.labelId);

  const handleClick = () => {
    if (node.labelId) {
      onSelect(node.labelId);
    } else if (hasChildren) {
      onToggleExpand(node.id);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggleExpand(node.id);
  };

  return (
    <div className="flex flex-col">
      <div
        className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors group ${
          isSelected ? "bg-primary/15 text-primary" : "hover:bg-muted"
        }`}
        style={{ paddingLeft: `${8 + node.depth * 12}px` }}
      >
        <button type="button" onClick={handleExpandClick} className="shrink-0 p-0.5">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={handleClick}
          className="flex min-w-0 flex-1 items-center gap-2 truncate"
          title={node.name}
        >
          {SYSTEM_ICONS[node.labelId || ""] || <FolderOpen className="h-4 w-4 shrink-0" />}
          <span
            className={`min-w-0 truncate ${
              node.unread && node.unread > 0 ? "font-semibold" : ""
            }`}
          >
            {node.name}
            {node.unread && node.unread > 0 ? ` (${node.unread})` : ""}
          </span>
        </button>
        {canDelete && onDelete && (
          <Tooltip content="Delete folder">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onDelete(node.labelId!, node.name); }}
            >
              <Trash className="h-3 w-3 text-destructive" />
            </Button>
          </Tooltip>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div className="ml-2 border-l border-border pl-1">
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              selectedLabel={selectedLabel}
              expanded={expanded}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
