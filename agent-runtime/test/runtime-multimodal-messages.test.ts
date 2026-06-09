import { describe, expect, test } from "bun:test"
import {
  RuntimeMessageSchema,
  toModelMessageContent,
  type RuntimeMessage,
} from "../src/runtime/types"

const imagePart = {
  type: "image" as const,
  mediaType: "image/png",
  filename: "sample.png",
  data: "iVBORw0KGgo=",
  encoding: "base64" as const,
}

const secondImagePart = {
  type: "image" as const,
  mediaType: "image/jpeg",
  filename: "second.jpg",
  data: "/9j/4AAQSkZJRg==",
  encoding: "base64" as const,
}

describe("runtime multimodal messages", () => {
  test("RuntimeMessageSchema accepts image parts", () => {
    const parsed = RuntimeMessageSchema.parse({
      id: "message_with_image",
      role: "user",
      content: "",
      parts: [imagePart],
    })

    expect(parsed.parts).toEqual([imagePart])
  })

  test("RuntimeMessageSchema rejects empty image data", () => {
    const result = RuntimeMessageSchema.safeParse({
      role: "user",
      content: "",
      parts: [{
        ...imagePart,
        data: "",
      }],
    })

    expect(result.success).toBe(false)
  })

  test("text-only message maps to a string without requiring capabilities", () => {
    const message: RuntimeMessage = {
      role: "user",
      content: "Plain text request",
    }

    expect(toModelMessageContent(message)).toBe("Plain text request")
  })

  test("text and image message maps to text then image content parts", () => {
    const content = toModelMessageContent({
      role: "user",
      content: "Describe this image.",
      parts: [imagePart],
    })

    expect(content).toEqual([
      { type: "text", text: "Describe this image." },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ])
  })

  test("user multimodal mapping preserves explicit parts order", () => {
    const content = toModelMessageContent({
      role: "user",
      content: "Fallback content should not duplicate explicit text.",
      parts: [
        imagePart,
        { type: "text", text: "Compare these images." },
        secondImagePart,
      ],
    })

    expect(content).toEqual([
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
      { type: "text", text: "Compare these images." },
      { type: "image", image: "/9j/4AAQSkZJRg==", mediaType: "image/jpeg" },
    ])
  })

  test("image-only message maps to image content parts", () => {
    const content = toModelMessageContent({
      role: "user",
      content: "",
      parts: [imagePart],
    })

    expect(content).toEqual([
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ])
  })

  test("uses text parts when content is empty and avoids duplicate content text", () => {
    const content = toModelMessageContent({
      role: "user",
      content: "Describe this image.",
      parts: [
        { type: "text", text: "Describe this image." },
        imagePart,
      ],
    })

    expect(content).toEqual([
      { type: "text", text: "Describe this image." },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ])

    const partOnlyContent = toModelMessageContent({
      role: "user",
      content: "",
      parts: [
        { type: "text", text: "Use the embedded text prompt." },
        imagePart,
      ],
    })

    expect(partOnlyContent).toEqual([
      { type: "text", text: "Use the embedded text prompt." },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ])
  })

  test("assistant image history maps to safe text placeholder instead of image parts", () => {
    const content = toModelMessageContent({
      role: "assistant",
      content: "I inspected the screenshot.",
      parts: [imagePart, secondImagePart],
    })

    expect(content).toBe("I inspected the screenshot. [2 images]")
  })

  test("can prefix orchestrator history text and image-only attribution", () => {
    const content = toModelMessageContent({
      role: "user",
      agentId: "coder",
      content: "",
      parts: [imagePart],
    }, {
      prefixAgentId: true,
    })

    expect(content).toEqual([
      { type: "text", text: "[coder]" },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ])

    expect(toModelMessageContent({
      role: "assistant",
      agentId: "coder",
      content: "",
      parts: [imagePart],
    }, {
      prefixAgentId: true,
    })).toBe("[coder] [image]")
  })
})
