# VideoToGif (TypeScript)

CLI em TypeScript para converter vídeos em GIF usando `ffmpeg`.

## Pré-requisitos

- Node.js (recomendado: 18+)
- `ffmpeg` instalado e disponível no PATH

### Instalar ffmpeg

- macOS (Homebrew): `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt-get install ffmpeg`
- Windows (Chocolatey): `choco install ffmpeg`

## Instalação

```bash
npm install
```

## Uso

Build + converter:

```bash
npm run convert -- input.mp4
```

Ou, após build, rodar direto:

```bash
npm run build
node dist/cli.js input.mp4 output.gif --width 640 --fps 20
```

Ajuda:

```bash
npm run help
```

## Frontend (web) bem simples

Iniciar servidor web:

```bash
npm run web
```

Abra no navegador: `http://localhost:3000`

## Instalar como comando global (opcional)

Dentro deste projeto:

```bash
npm run build
npm link
videotogif input.mp4
```
