type AudioPreviewProps = {
  url: string
  name: string
  mimeType: string
}

export function AudioPreview({ url, name, mimeType }: AudioPreviewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <audio
        controls
        className="w-full max-w-md"
        preload="metadata"
      >
        <source src={url} type={mimeType} />
        {name}
      </audio>
    </div>
  )
}
