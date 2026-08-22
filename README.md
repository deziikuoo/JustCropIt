# JustCropIt ✂️
https://deziikuoo.github.io/JustCropIt/


**A little side project that fixed a really specific problem I kept running into.**
Mobile Compatibility is currently being developed
I was trying to crop a bunch of images to the exact same size and position, and every tool I tried either:

- Gave me slightly different crops on each image, or
- Wanted me to pay or upload my photos to somebody's server.

So I built JustCropIt for myself: a way to get **pixel-perfect, repeatable crops** across multiple photos, right in the browser, with no account, no paywall, and no upload.

It's still very much a work in progress, and I'm planning to add more editing features over time (filters, more batch tools, etc.).  
If you have ideas, run into bugs, or just have opinions, I'm genuinely open to feedback and critiques – this started as a tool I needed, but if it solves the same headache for you, even better.

All of this runs **100% in your browser**. No downloads, no servers, no subscriptions, no credit card required.

## 🌟 Key Features

### ✂️ **Precise Copy & Paste Cropping**

Set up your perfect crop once, copy the exact settings, and apply them to dozens of images instantly. Consistent results every time.

### 🧠 **Smart Batch Cropping**

Batch mode goes beyond a fixed rectangle:

- **Same crop box** — classic template crop on every selected photo.
- **Follow subject** — pick a crop target (full body, upper body, head, etc.); each photo is cropped around its own detected subject.
- **This person** — lock onto one person across frames using reference images (auto-picked + manual refs).
- **Remove letterboxing** — strip black bars / pillarboxing from each image in one pass.
- **Crop to object** (in development) — SAM-based object selection for batch crops.

Crop targets in the editor: full body, upper body, lower body, head & shoulders, or head.

### 🎬 **Video → Images**

Extract frames from video in the browser (WebCodecs + workers): trim a segment, estimate frame count, then **Generate Frames** and add them straight into your photo grid. Video imports use a fast path so large frame batches don’t feel like re-uploading every file.

### 🖼️ **Multi-Image Upload & Batch Processing**

Upload multiple photos at once and process them efficiently, whether you're cropping 5 photos or 500.

### 📋 **Batch Edit Panel**

When you're working on a batch, a dedicated panel stays with you while you scroll — file list, tools, and progress without losing context.

### 🔄 **Rotation & Object Tools**

In the crop modal:

- **Fine rotation wheel** for smooth angle tweaks beyond 90° steps.
- **Trim letterboxing** on a single image.
- **Crop to object** — mark an object with SAM (segmentation model cached locally after first use).

### 📦 **Batch Operations**

Flip, revert, or download multiple images at once. Select with intuitive drag-to-select, then apply changes to the entire group. Photo actions live in a hover menu for a cleaner grid.

### 📥 **Export & Download**

- Download one photo or a **ZIP** of your batch.
- Choose **replace originals** or **make copies** (with a session “remember” option).
- Download names are **stamped** so separate jobs don’t overwrite each other in your Downloads folder.

### 💾 **Client-Side Storage**

Photos and edits are stored locally using IndexedDB and OPFS where available. They persist between sessions, never leave your device, and are automatically cleaned up after about 24 hours.

### 💬 **Feedback & Support**

In-app panel for feedback, bug reports, and optional project support links.

### 📱 **Responsive Design**

Works on desktop, tablet, and mobile (smart batch modes that need face detection require a modern browser with the right APIs).

### ⚡ **Zero Backend**

Everything runs in your browser. Fast, private, and completely free.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 🛠️ Tech Stack

- **Vue 3** - Progressive JavaScript framework
- **TypeScript** - Type-safe development
- **Vite** - Next-generation frontend tooling
- **IndexedDB / OPFS** - Client-side storage
- **Canvas API** - Image processing
- **WebCodecs** - Video frame extraction
- **Web Workers** - Off-main-thread decode, detection, and export
- **JSZip** - Batch downloads
- **SAM 2 (sam-web)** - Optional on-device object segmentation

## 📸 Screenshots

[Add screenshots/GIFs here]

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for your own purposes.
