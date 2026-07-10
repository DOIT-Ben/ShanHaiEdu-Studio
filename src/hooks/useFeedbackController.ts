"use client";

import { useEffect, useRef, useState } from "react";
import { FeedbackApiError, submitFeedback } from "@/lib/feedback-api";
import type {
  FeedbackCategory,
  FeedbackOpenInput,
  FeedbackSeverity,
  FeedbackSubmissionResponse,
} from "@/lib/feedback-contracts";

export const MAX_FEEDBACK_IMAGES = 5;
const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FEEDBACK_TOTAL_BYTES = 25 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type FeedbackDraftImage = {
  id: string;
  file: File;
  previewUrl: string;
  source: "selected" | "pasted";
};

export type FeedbackDraftStatus = "draft" | "submitting" | "submitted" | "failed";

export function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useFeedbackController() {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<FeedbackOpenInput>({ origin: "global" });
  const [category, setCategoryState] = useState<FeedbackCategory | "">("");
  const [description, setDescriptionState] = useState("");
  const [severity, setSeverityState] = useState<FeedbackSeverity | "">("");
  const [images, setImages] = useState<FeedbackDraftImage[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [status, setStatus] = useState<FeedbackDraftStatus>("draft");
  const [receipt, setReceipt] = useState<FeedbackSubmissionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const imagesRef = useRef<FeedbackDraftImage[]>([]);
  const inFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    inFlightRef.current = false;
    revokeImages(imagesRef.current);
    imagesRef.current = [];
  }, []);

  function beginPayloadMutation() {
    if (inFlightRef.current) return;
    setIdempotencyKey(createIdempotencyKey());
    setStatus("draft");
    setReceipt(null);
    setErrorMessage(null);
    setValidationError(null);
  }

  function openFeedback(input: FeedbackOpenInput) {
    invalidateInFlightRequest();
    revokeImages(imagesRef.current);
    imagesRef.current = [];
    setImages([]);
    setContext(input);
    setCategoryState("");
    setDescriptionState("");
    setSeverityState("");
    setIdempotencyKey(createIdempotencyKey());
    setStatus("draft");
    setReceipt(null);
    setErrorMessage(null);
    setValidationError(null);
    setOpen(true);
  }

  function closeFeedback() {
    invalidateInFlightRequest();
    setOpen(false);
    revokeImages(imagesRef.current);
    imagesRef.current = [];
    setImages([]);
  }

  function setCategory(value: FeedbackCategory) {
    if (inFlightRef.current) return;
    if (value === category) return;
    setCategoryState(value);
    beginPayloadMutation();
  }

  function setDescription(value: string) {
    if (inFlightRef.current) return;
    if (value === description) return;
    setDescriptionState(value);
    beginPayloadMutation();
  }

  function appendDescriptionChip(value: string) {
    if (inFlightRef.current) return;
    if (description.includes(value)) return;
    setDescriptionState(description.trim() ? `${description.trimEnd()}\n${value}` : value);
    beginPayloadMutation();
  }

  function setSeverity(value: FeedbackSeverity | "") {
    if (inFlightRef.current) return;
    if (value === severity) return;
    setSeverityState(value);
    beginPayloadMutation();
  }

  function addImages(files: File[], source: FeedbackDraftImage["source"]) {
    if (inFlightRef.current) return;
    if (files.length === 0) return;
    const currentImages = imagesRef.current;
    const nextCount = currentImages.length + files.length;
    if (nextCount > MAX_FEEDBACK_IMAGES) {
      setValidationError(`最多添加 ${MAX_FEEDBACK_IMAGES} 张图片。`);
      return;
    }
    const unsupported = files.find((file) => !ACCEPTED_IMAGE_TYPES.has(file.type));
    if (unsupported) {
      setValidationError("请选择 PNG、JPEG 或 WebP 图片。");
      return;
    }
    const oversized = files.find((file) => file.size > MAX_FEEDBACK_IMAGE_BYTES);
    if (oversized) {
      setValidationError("单张图片不能超过 10 MB。");
      return;
    }
    const totalBytes = [...currentImages.map((image) => image.file), ...files].reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_FEEDBACK_TOTAL_BYTES) {
      setValidationError("全部图片合计不能超过 25 MB。");
      return;
    }

    const nextImages = files.map((file) => ({
      id: createIdempotencyKey(),
      file,
      previewUrl: URL.createObjectURL(file),
      source,
    }));
    const updatedImages = [...currentImages, ...nextImages];
    imagesRef.current = updatedImages;
    setImages(updatedImages);
    beginPayloadMutation();
  }

  function removeImage(imageId: string) {
    if (inFlightRef.current) return;
    const image = imagesRef.current.find((item) => item.id === imageId);
    if (!image) return;
    URL.revokeObjectURL(image.previewUrl);
    const updatedImages = imagesRef.current.filter((item) => item.id !== imageId);
    imagesRef.current = updatedImages;
    setImages(updatedImages);
    beginPayloadMutation();
  }

  async function submit() {
    if (inFlightRef.current) return;
    if (!category) {
      setValidationError("请先选择反馈类型。");
      return;
    }
    const normalizedDescription = description.trim();
    if (!normalizedDescription) {
      setValidationError("请写下你遇到的情况或期待的改进。");
      return;
    }

    inFlightRef.current = true;
    const requestGeneration = ++requestGenerationRef.current;
    setStatus("submitting");
    setErrorMessage(null);
    setValidationError(null);
    try {
      const response = await submitFeedback({
        metadata: {
          category,
          description: normalizedDescription,
          ...(severity ? { severity } : {}),
          idempotencyKey,
          origin: context.origin,
          ...(context.projectId ? { projectId: context.projectId } : {}),
          ...(context.messageId ? { messageId: context.messageId } : {}),
          pageRoute: `${window.location.pathname}${window.location.search}`,
          clientContext: {
            userAgent: navigator.userAgent,
            language: navigator.language,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          },
        },
        images: imagesRef.current.map((image) => image.file),
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      setReceipt(response);
      setStatus("submitted");
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setStatus("failed");
      setErrorMessage(
        error instanceof FeedbackApiError
          ? error.userMessage
          : "反馈暂时没有提交成功，内容和图片已为你保留，请稍后重试。",
      );
    } finally {
      if (requestGeneration === requestGenerationRef.current) inFlightRef.current = false;
    }
  }

  function invalidateInFlightRequest() {
    requestGenerationRef.current += 1;
    inFlightRef.current = false;
  }

  return {
    open,
    context,
    category,
    description,
    severity,
    images,
    idempotencyKey,
    status,
    receipt,
    errorMessage,
    validationError,
    openFeedback,
    closeFeedback,
    setCategory,
    setDescription,
    appendDescriptionChip,
    setSeverity,
    addImages,
    removeImage,
    submit,
  };
}

function revokeImages(images: FeedbackDraftImage[]) {
  for (const image of images) URL.revokeObjectURL(image.previewUrl);
}

export type FeedbackController = ReturnType<typeof useFeedbackController>;
