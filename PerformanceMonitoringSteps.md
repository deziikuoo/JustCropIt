Performance Logger Utility (src/utils/performanceLogger.ts)
Tracks operation time, per-image time, and memory usage
Console logging with readable output
Export to JSON/CSV
Comparison utilities for before/after metrics
Performance Dashboard Component (src/components/PerformanceDashboard.vue)
Visual dashboard showing all metrics
Summary cards with totals
Operation list with details
Export buttons
Only visible in development mode
Integration into App.vue
Measurement hooks added to:
handleBatchFlip - Tracks batch flip operations
handleBatchCropNext - Tracks batch crop operations
handlePasteSettings - Tracks paste settings operations
handleBatchDownload - Tracks batch download operations
How to use
Run batch operations:
The logger automatically tracks all batch operations
Metrics appear in the console with this format:
📊 FLIP Performance: Images: 531 Total Time: 52.34s (52341ms) Per Image: 98.58ms Memory: 245MB → 287MB (+42MB) Method: 🐌 Main Thread
View the dashboard:
In development mode, you'll see a ⚡ button in the bottom-right corner
Click it to open the Performance Dashboard
View all metrics, totals, and averages
Export data:
Click "Export JSON" or "Export CSV" in the dashboard
Files download with timestamps
Use for comparison before/after implementing Web Workers
Next steps
Record baseline metrics:
Perform your batch operations (flip, crop, paste, download, delete)
Export the metrics to CSV/JSON
Save as baseline-metrics.json or baseline-metrics.csv
After implementing Web Workers:
Change workerUsed: false to workerUsed: true in the measurement calls
Run the same operations
Export new metrics
Compare to see improvements
Use the comparison feature:
Load your baseline metrics
Load your optimized metrics
Use the compareMetrics() function to see percentage improvements
