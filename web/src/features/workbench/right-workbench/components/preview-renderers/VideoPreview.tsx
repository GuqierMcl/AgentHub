type VideoPreviewProps = {
  url: string
  name: string
  mimeType: string
  posterUrl?: string
}

export function VideoPreview({ url, name, mimeType, posterUrl }: VideoPreviewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <video
        controls
        className="max-h-full max-w-full rounded"
        preload="metadata"
        poster={posterUrl}
      >
        <source src={url} type={mimeType} />
        {name}
      </video>
    </div>
  )
}
