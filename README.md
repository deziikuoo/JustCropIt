# JustCropIt ✂️

**A little side project that fixed a really specific problem I kept running into.**

I was trying to crop a bunch of images to the exact same size and position, and every tool I tried either:

- Gave me slightly different crops on each image, or
- Wanted me to pay or upload my photos to somebody's server.

So I built JustCropIt for myself: a way to get **pixel-perfect, repeatable crops** across multiple photos, right in the browser, with no account, no paywall, and no upload.

It's still very much a work in progress, and I'm planning to add more editing features over time (filters, rotation, more batch tools, etc.).  
If you have ideas, run into bugs, or just have opinions, I'm genuinely open to feedback and critiques – this started as a tool I needed, but if it solves the same headache for you, even better.

All of this runs **100% in your browser**. No downloads, no servers, no subscriptions, no credit card required.

## 🌟 Key Features

### ✂️ **Precise Copy & Paste Cropping**

Set up your perfect crop once, copy the exact settings, and apply them to dozens of images instantly. Consistent results every time.

### 🖼️ **Multi-Image Upload & Batch Processing**

Upload multiple photos at once and process them efficiently, whether you're cropping 5 photos or 500.

### 📦 **Batch Operations**

Flip, revert, or download multiple images at once. Select with intuitive drag-to-select, then apply changes to the entire group.

### 💾 **Client-Side Storage**

Photos and edits are stored locally using IndexedDB. They persist between sessions, never leave your device, and are automatically cleaned up after about 24 hours.

### 📥 **Batch Download**

Download all your edited images at once as a convenient ZIP file.

### 📱 **Responsive Design**

Works beautifully on desktop, tablet, and mobile devices.

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
- **IndexedDB** - Client-side storage
- **Canvas API** - Image processing
- **JSZip** - Batch downloads

## 📸 Screenshots

[Add screenshots/GIFs here]

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for your own purposes.
