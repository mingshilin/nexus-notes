import {
  AiActionInputSchema,
  AiOrganizationToolNameSchema,
  type ApplyDatabaseTemplateInput,
  type ApplyTagActionInput,
  type ApplyTemplateActionInput,
  type CreateDatabaseRecordActionInput,
  type CreateFolderActionInput,
  type UpdateDatabaseRecordActionInput,
  type AiActionToolName,
  type WorkspaceContext,
} from "@nexus/contracts";

import { aiActionTargetId } from "./ai-tool-model";

export type AiOrganizationToolName = ReturnType<typeof AiOrganizationToolNameSchema.parse>;
export type AiOrganizationInput =
  | CreateFolderActionInput
  | ApplyTagActionInput
  | CreateDatabaseRecordActionInput
  | UpdateDatabaseRecordActionInput
  | ApplyTemplateActionInput;

export interface AiOrganizationServices {
  knowledge: {
    createFolder(
      context: { workspaceId: string; userId: string; targetId?: string },
      input: CreateFolderActionInput,
    ): Promise<unknown>;
    setNoteTagsBatch(
      context: { workspaceId: string; userId: string; targetId?: string },
      noteIds: string[],
      input: { tag_ids: string[] },
    ): Promise<unknown>;
  };
  databases: {
    createRecord(
      context: WorkspaceContext & { requestId?: string; targetId?: string },
      databaseId: string,
      input: { note_id?: string | null; values: Record<string, unknown> },
      expectedDatabaseRevision?: number,
    ): Promise<unknown>;
    updateRecord(
      context: WorkspaceContext & { requestId?: string },
      databaseId: string,
      recordId: string,
      input: { base_revision: number; values: Record<string, unknown> },
    ): Promise<unknown>;
    applyTemplate(
      context: WorkspaceContext & { requestId?: string },
      databaseId: string,
      input: ApplyDatabaseTemplateInput,
      expectedTemplateRevision?: number,
    ): Promise<unknown>;
  };
}

export interface AiOrganizationExecutionMeta {
  actionId: string;
  requestId?: string;
}

export function isAiOrganizationTool(tool: AiActionToolName): tool is AiOrganizationToolName {
  return AiOrganizationToolNameSchema.safeParse(tool).success;
}

export function normalizeAiOrganizationInput(tool: AiOrganizationToolName, raw: Record<string, unknown>) {
  const { workspace_id: _workspaceId, ...input } = raw;
  const parsed = AiActionInputSchema.parse({ tool, input });
  if (!isAiOrganizationTool(parsed.tool)) throw new Error("AI organization tool is not allowlisted");
  return { tool: parsed.tool, input: parsed.input as AiOrganizationInput };
}

export class AiOrganizationTools {
  constructor(private readonly services: AiOrganizationServices) {}

  async execute(
    context: WorkspaceContext,
    tool: AiOrganizationToolName,
    input: AiOrganizationInput,
    meta: AiOrganizationExecutionMeta,
  ) {
    switch (tool) {
      case "create_folder":
        return this.services.knowledge.createFolder(
          { workspaceId: context.workspaceId, userId: context.userId, targetId: aiActionTargetId(tool, meta.actionId) },
          input as CreateFolderActionInput,
        );
      case "apply_tag":
        return this.applyTags(context, input as ApplyTagActionInput, meta);
      case "create_database_record": {
        const recordInput = input as CreateDatabaseRecordActionInput;
        return this.services.databases.createRecord(
          { ...context, ...(meta.requestId ? { requestId: meta.requestId } : {}), targetId: aiActionTargetId(tool, meta.actionId) },
          recordInput.database_id,
          { note_id: recordInput.note_id ?? null, values: recordInput.values },
          recordInput.base_revision,
        );
      }
      case "update_database_record": {
        const recordInput = input as UpdateDatabaseRecordActionInput;
        return this.services.databases.updateRecord(
          { ...context, ...(meta.requestId ? { requestId: meta.requestId } : {}) },
          recordInput.database_id,
          recordInput.record_id,
          { base_revision: recordInput.base_revision, values: recordInput.values },
        );
      }
      case "apply_template": {
        const templateInput = input as ApplyTemplateActionInput;
        return this.services.databases.applyTemplate(
          { ...context, ...(meta.requestId ? { requestId: meta.requestId } : {}) },
          templateInput.database_id,
          { template_id: templateInput.template_id, records: templateInput.records },
          templateInput.base_revision,
        );
      }
    }
  }

  private async applyTags(context: WorkspaceContext, input: ApplyTagActionInput, meta: AiOrganizationExecutionMeta) {
    const noteContext = {
      workspaceId: context.workspaceId,
      userId: context.userId,
      targetId: aiActionTargetId("apply_tag", meta.actionId),
    };
    return this.services.knowledge.setNoteTagsBatch(noteContext, input.target_note_ids, { tag_ids: input.tag_ids });
  }
}
