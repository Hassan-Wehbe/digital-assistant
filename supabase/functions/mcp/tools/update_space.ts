import { z } from "zod";
import { rejectCredentials } from "../lib/credentials.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

// Rename a space or change its description (owner, 2026-10-07). Only these two: whether a space
// is restricted, and where it sits, are not changed here (rule 3; moving can make loops).
export const registerUpdateSpace: RegisterTool = (server, { db, assistantName }) => {
  server.registerTool(
    "update_space",
    {
      title: "Rename a space or change its description",
      description:
        "Change a space's name and/or description. Only these two; it never changes whether a space " +
        "is restricted or where it sits. An empty description removes it. Items in the space are not " +
        "touched.",
      inputSchema: {
        space: z.string().describe("Space name, path (Work/Gartner) or id"),
        name: z.string().trim().min(1).max(100).optional().describe("The new name, e.g. Cooking"),
        description: z.string().trim().max(500).optional().describe("The new description; empty to remove it"),
      },
    },
    ({ space, name, description }) =>
      guarded(async () => {
        if (name === undefined && description === undefined) {
          throw new Error("Give a new name, a new description, or both.");
        }
        if (name?.includes("/")) throw new Error("Space names cannot contain '/'.");
        // Rule 9: a name or description is free text, so no credentials in it either.
        rejectCredentials({ name, description }, assistantName);
        const spaces = await loadSpaces(db);
        const target = resolveSpace(spaces, space);
        if (name !== undefined) {
          const taken = spaces.find((s) =>
            s.id !== target.id && s.parent_id === target.parent_id && s.name.toLowerCase() === name.toLowerCase()
          );
          if (taken) throw new Error(`There is already a space called "${taken.path}". Choose another name.`);
        }
        const change: { name?: string; description?: string | null } = {};
        if (name !== undefined) change.name = name;
        if (description !== undefined) change.description = description || null;
        const { error } = await db.from("space").update(change).eq("id", target.id).select("id").single();
        if (error) throw dbError(`Could not change the space "${target.path}"`, error);
        const parentPath = target.path.slice(0, target.path.length - target.name.length);
        return ok({
          id: target.id,
          path: parentPath + (change.name ?? target.name),
          previous_path: target.path,
          description: "description" in change ? change.description : target.description,
          restricted: target.is_restricted,
        });
      }),
  );
};
