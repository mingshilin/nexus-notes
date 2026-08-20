import { z } from "zod";

export const ApiErrorPayloadSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  request_id: z.string().trim().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiErrorPayload = z.infer<typeof ApiErrorPayloadSchema>;

export type ApiResponse<T> =
  | {
      success: true;
      data: T;
      meta?: Record<string, unknown>;
      request_id: string;
    }
  | {
      success: false;
      error: ApiErrorPayload;
      request_id: string;
    };

export function createSuccessResponse<T>(
  data: T,
  requestId: string,
  meta?: Record<string, unknown>,
): ApiResponse<T> {
  return meta === undefined
    ? { success: true, data, request_id: requestId }
    : { success: true, data, meta, request_id: requestId };
}

export function createFailureResponse(
  error: Omit<ApiErrorPayload, "request_id">,
  requestId: string,
): ApiResponse<never> {
  return {
    success: false,
    error: { ...error, request_id: requestId },
    request_id: requestId,
  };
}

export function createApiResponseSchema<T extends z.ZodType>(dataSchema: T) {
  const successSchema = z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().min(1),
  });
  const failureSchema = z.object({
    success: z.literal(false),
    error: ApiErrorPayloadSchema,
    request_id: z.string().min(1),
  });

  return z.discriminatedUnion("success", [successSchema, failureSchema]);
}
