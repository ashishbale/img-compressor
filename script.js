// Initialize PDF.js
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

let currentMode = 'compress';
let originalFile = null;
let processedBlob = null;

const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const uploadArea = document.querySelector('.upload-area');

fileInput.addEventListener('change', handleFileSelect);

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const uploadText = document.getElementById('uploadText');
    const uploadSubtext = document.getElementById('uploadSubtext');
    
    if (mode === 'compress') {
        uploadText.textContent = 'Click to upload file';
        uploadSubtext.textContent = 'Supports JPG, PNG, WebP, PDF (Max 10MB)';
        fileInput.accept = 'image/jpeg,image/jpg,image/png,image/webp,application/pdf';
    } else {
        uploadText.textContent = 'Click to upload image';
        uploadSubtext.textContent = 'Supports JPG, PNG, WebP - Will convert to PDF';
        fileInput.accept = 'image/jpeg,image/jpg,image/png,image/webp';
    }
    
    reset();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        fileInput.value = '';
        return;
    }

    originalFile = file;
    uploadSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    loadingSection.classList.remove('hidden');

    try {
        if (currentMode === 'compress') {
            if (file.type === 'application/pdf') {
                await compressPDF(file);
            } else {
                await compressImage(file);
            }
        } else {
            await convertImageToPDF(file);
        }
    } catch (error) {
        alert('Error processing file: ' + error.message);
        reset();
    }
}

async function compressImage(file) {
    document.getElementById('loadingText').textContent = 'Compressing image...';
    
    const compressed = await compressImageFile(file);
    processedBlob = compressed;

    const originalPreviewUrl = URL.createObjectURL(file);
    const compressedPreviewUrl = URL.createObjectURL(compressed);

    document.getElementById('originalPreviewContainer').innerHTML = `<img src="${originalPreviewUrl}" alt="Original">`;
    document.getElementById('processedPreviewContainer').innerHTML = `<img src="${compressedPreviewUrl}" alt="Compressed">`;

    const reduction = ((file.size - compressed.size) / file.size * 100).toFixed(1);

    document.getElementById('resultTitle').textContent = 'Compression Complete!';
    document.getElementById('resultStats').innerHTML = `<span>${formatFileSize(file.size)}</span> → <span>${formatFileSize(compressed.size)}</span><span class="reduction">(${reduction}% reduction)</span>`;
    document.getElementById('originalSizeCard').textContent = formatFileSize(file.size);
    document.getElementById('processedSizeCard').textContent = formatFileSize(compressed.size);
    document.getElementById('originalTitle').textContent = 'Original';
    document.getElementById('processedTitle').textContent = 'Compressed';

    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
}

function compressImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = img.width;
                canvas.height = img.height;
                
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                let quality = 0.95;
                const targetSize = 500 * 1024;
                
                const tryCompress = () => {
                    canvas.toBlob(
                        (blob) => {
                            if (blob.size <= targetSize || quality <= 0.1) {
                                resolve(blob);
                            } else {
                                quality -= 0.05;
                                tryCompress();
                            }
                        },
                        'image/jpeg',
                        quality
                    );
                };
                
                tryCompress();
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function compressPDF(file) {
    document.getElementById('loadingText').textContent = 'Compressing PDF...';
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        
        // Load PDF with PDF.js
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        // Create new PDF with pdf-lib
        const pdfDoc = await PDFLib.PDFDocument.create();
        
        const numPages = pdf.numPages;
        
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            
            // Create canvas
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            // Render PDF page to canvas
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;
            
            // Convert canvas to compressed JPEG
            const imageBlob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', 0.75);
            });
            
            const imageBytes = await imageBlob.arrayBuffer();
            const image = await pdfDoc.embedJpg(imageBytes);
            
            // Add page with compressed image
            const pdfPage = pdfDoc.addPage([viewport.width, viewport.height]);
            pdfPage.drawImage(image, {
                x: 0,
                y: 0,
                width: viewport.width,
                height: viewport.height,
            });
        }
        
        // Save compressed PDF
        const compressedPdfBytes = await pdfDoc.save({
            useObjectStreams: true,
            addDefaultPage: false,
        });
        
        processedBlob = new Blob([compressedPdfBytes], { type: 'application/pdf' });
        
        // If compressed version is larger, use original with basic optimization
        if (processedBlob.size >= file.size) {
            const originalPdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            const optimizedBytes = await originalPdfDoc.save({
                useObjectStreams: true,
                addDefaultPage: false,
            });
            processedBlob = new Blob([optimizedBytes], { type: 'application/pdf' });
        }
        
    } catch (error) {
        console.error('PDF compression error:', error);
        // Fallback: basic compression
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const compressedBytes = await pdfDoc.save({
            useObjectStreams: true,
            addDefaultPage: false,
        });
        processedBlob = new Blob([compressedBytes], { type: 'application/pdf' });
    }
    
    const reduction = ((file.size - processedBlob.size) / file.size * 100).toFixed(1);
    
    document.getElementById('originalPreviewContainer').innerHTML = `<div class="pdf-placeholder"><div class="pdf-icon">📄</div><div>Original PDF</div><div style="margin-top: 10px; font-size: 12px;">${Math.round(file.size / 1024)} KB</div></div>`;
    document.getElementById('processedPreviewContainer').innerHTML = `<div class="pdf-placeholder"><div class="pdf-icon">📄</div><div>Compressed PDF</div><div style="margin-top: 10px; font-size: 12px;">${Math.round(processedBlob.size / 1024)} KB</div></div>`;
    
    document.getElementById('resultTitle').textContent = 'PDF Compression Complete!';
    document.getElementById('resultStats').innerHTML = `<span>${formatFileSize(file.size)}</span> → <span>${formatFileSize(processedBlob.size)}</span><span class="reduction">(${reduction}% reduction)</span>`;
    document.getElementById('originalSizeCard').textContent = formatFileSize(file.size);
    document.getElementById('processedSizeCard').textContent = formatFileSize(processedBlob.size);
    document.getElementById('originalTitle').textContent = 'Original PDF';
    document.getElementById('processedTitle').textContent = 'Compressed PDF';
    
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
}

async function compressPDFWithImages(pdfDoc, pages) {
    // This function is no longer needed but kept for compatibility
    const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
    });
    
    return new Blob([compressedBytes], { type: 'application/pdf' });
}

async function convertImageToPDF(file) {
    document.getElementById('loadingText').textContent = 'Converting to PDF...';
    
    const imageData = await file.arrayBuffer();
    const pdfDoc = await PDFLib.PDFDocument.create();
    
    let image;
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
        image = await pdfDoc.embedJpg(imageData);
    } else if (file.type === 'image/png') {
        image = await pdfDoc.embedPng(imageData);
    } else {
        // For WebP or other formats, convert to JPEG first
        const img = await createImageBitmap(new Blob([imageData]));
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const jpegData = await new Promise(resolve => {
            canvas.toBlob(blob => blob.arrayBuffer().then(resolve), 'image/jpeg', 0.95);
        });
        image = await pdfDoc.embedJpg(jpegData);
    }
    
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
    });
    
    const pdfBytes = await pdfDoc.save();
    processedBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    
    const originalPreviewUrl = URL.createObjectURL(file);
    document.getElementById('originalPreviewContainer').innerHTML = `<img src="${originalPreviewUrl}" alt="Original">`;
    document.getElementById('processedPreviewContainer').innerHTML = `<div class="pdf-placeholder"><div class="pdf-icon">📄</div><div>PDF Document</div></div>`;
    
    document.getElementById('resultTitle').textContent = 'Conversion Complete!';
    document.getElementById('resultStats').innerHTML = `Image converted to PDF<br>Size: ${formatFileSize(processedBlob.size)}`;
    document.getElementById('originalSizeCard').textContent = formatFileSize(file.size);
    document.getElementById('processedSizeCard').textContent = formatFileSize(processedBlob.size);
    document.getElementById('originalTitle').textContent = 'Original Image';
    document.getElementById('processedTitle').textContent = 'PDF Document';
    
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
}

function downloadFile() {
    if (!processedBlob || !originalFile) return;
    
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement('a');
    a.href = url;
    
    const originalName = originalFile.name;
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
    
    if (currentMode === 'convert') {
        a.download = `${nameWithoutExt}.pdf`;
    } else if (originalFile.type === 'application/pdf') {
        a.download = `${nameWithoutExt}_compressed.pdf`;
    } else {
        a.download = `${nameWithoutExt}_compressed.jpg`;
    }
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function reset() {
    originalFile = null;
    processedBlob = null;
    fileInput.value = '';
    uploadSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
}

// Drag and drop functionality
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#764ba2';
    uploadArea.style.background = '#f8f9ff';
});

uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#667eea';
    uploadArea.style.background = 'transparent';
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#667eea';
    uploadArea.style.background = 'transparent';
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        handleFileSelect({ target: { files: files } });
    }
});

// Initialize with compress mode
setMode('compress');