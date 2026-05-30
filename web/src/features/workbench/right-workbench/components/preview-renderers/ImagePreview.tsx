type ImagePreviewProps = {
  src: string
  alt: string
}

export function ImagePreview({ src, alt }: ImagePreviewProps) {
  return (
    <div className="flex h-full w-full min-h-0 items-center justify-center p-4 overflow-hidden">
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full w-auto h-auto object-contain rounded"
      />
    </div>
  )
}
