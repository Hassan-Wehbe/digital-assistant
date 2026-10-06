// Every tool Wilma offers, in one list. The MCP server (index.ts), the chat function and the
// evaluation (tests/eval/harness.ts) all register exactly these, so they cannot drift apart.
import { registerListSpaces } from "./list_spaces.ts";
import { registerCreateSpace } from "./create_space.ts";
import { registerSaveItem } from "./save_item.ts";
import { registerUpdateItem } from "./update_item.ts";
import { registerGetItem } from "./get_item.ts";
import { registerSearchItems } from "./search_items.ts";
import { registerFindPlaces } from "./find_places.ts";
import { registerLinkItems } from "./link_items.ts";
import { registerSaveSecret } from "./save_secret.ts";
import { registerFindSecret } from "./find_secret.ts";
import { registerGetSecret } from "./get_secret.ts";
import { registerUpdateSecret } from "./update_secret.ts";
import { registerDeleteSecret } from "./delete_secret.ts";
import { registerSetAssistantName } from "./set_assistant_name.ts";
import { registerAttachFile } from "./attach_file.ts";
import { registerGetAttachmentLink } from "./get_attachment_link.ts";
import { registerDescribeAttachment } from "./describe_attachment.ts";
import { registerDeleteAttachment } from "./delete_attachment.ts";
import { registerDeleteItem } from "./delete_item.ts";
import { registerListDeletedItems, registerPurgeItem, registerRestoreItem } from "./recycle_bin.ts";
import { registerDeleteSpace } from "./delete_space.ts";
import type { RegisterTool } from "./_shared.ts";

export const ALL_TOOLS: RegisterTool[] = [
  registerListSpaces,
  registerCreateSpace,
  registerSaveItem,
  registerUpdateItem,
  registerGetItem,
  registerSearchItems,
  registerFindPlaces,
  registerLinkItems,
  registerSaveSecret,
  registerFindSecret,
  registerGetSecret,
  registerUpdateSecret,
  registerDeleteSecret,
  registerSetAssistantName,
  registerAttachFile,
  registerGetAttachmentLink,
  registerDescribeAttachment,
  registerDeleteAttachment,
  registerDeleteItem,
  registerListDeletedItems,
  registerRestoreItem,
  registerPurgeItem,
  registerDeleteSpace,
];
