import React, { useRef, useState, useCallback, useEffect } from 'react';
import { identifyVinylsFromImage } from '../services/geminiService';
import { VinylRecord, ScanResult } from '../types';

interface ScannerProps {
  onScanComplete: (records: VinylRecord[]) => void;
  onCancel: () => void;
}

export const Scanner: React.FC<ScannerProps> = ({ onScanComplete, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedRecords, setDetectedRecords] = useState<ScanResult[]>([]);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Start Camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Unable to access camera. Please try uploading a file.");
    }
  }, []);

  // Stop Camera
  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const handleCapture = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedImage(dataUrl);
        stopCamera();
        analyzeImage(dataUrl.split(',')[1]); // Remove data:image/jpeg;base64, prefix
      }
    }
  }, [stopCamera]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setCapturedImage(result);
        stopCamera();
        analyzeImage(result.split(',')[1]);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async (base64Data: string) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const results = await identifyVinylsFromImage(base64Data);
      if (results.length === 0) {
        setError("No vinyl records could be clearly identified. Try again?");
      }
      setDetectedRecords(results);
    } catch (err) {
      setError("Failed to analyze image. Please check your connection.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirm = () => {
    // Convert ScanResults to VinylRecords
    const newRecords: VinylRecord[] = detectedRecords.map((scan, idx) => ({
      id: `scan-${Date.now()}-${idx}`,
      artist: scan.artist,
      title: scan.title,
      year: scan.year,
      genre: scan.genre,
      // Use the captured image for the first record, or a placeholder if multiple
      coverUrl: capturedImage || undefined, 
      dateAdded: Date.now(),
      notes: `Identified via AI with ${(scan.confidence * 100).toFixed(0)}% confidence.`
    }));
    
    onScanComplete(newRecords);
  };

  return (
    <div className="flex flex-col h-full bg-black text-white p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-vinyl-accent">Scan Vinyl</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-white">Close</button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden rounded-lg bg-gray-900 border border-vinyl-700">
        
        {/* Video View */}
        {!capturedImage && !error && (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Captured Image View */}
        {capturedImage && (
          <img 
            src={capturedImage} 
            alt="Captured" 
            className="absolute inset-0 w-full h-full object-contain bg-black" 
          />
        )}

        {/* Hidden Canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Overlay UI */}
        <div className="absolute inset-0 flex flex-col justify-end p-6 pointer-events-none">
          
          {/* Scanning Animation */}
          {isAnalyzing && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10 pointer-events-auto">
              <div className="w-16 h-16 border-4 border-vinyl-accent border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-lg font-bold animate-pulse">Analyzing Grooves...</p>
            </div>
          )}

          {/* Controls (Only visible when not analyzing) */}
          {!isAnalyzing && !detectedRecords.length && (
            <div className="w-full flex flex-col gap-4 pointer-events-auto items-center">
              {error && (
                <div className="bg-red-900/80 text-white p-3 rounded mb-2 text-center w-full">
                  {error}
                </div>
              )}
              
              {!capturedImage ? (
                <div className="flex gap-4 w-full justify-center items-center">
                   {/* File Upload Button */}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-4 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </button>
                  <input 
                    type="file" 
                    accept="image/*" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />

                  {/* Capture Button */}
                  <button 
                    onClick={handleCapture}
                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-vinyl-accent/20 hover:bg-vinyl-accent/40 transition-all active:scale-95"
                  >
                    <div className="w-16 h-16 bg-white rounded-full"></div>
                  </button>

                  <div className="w-12"></div> {/* Spacer for balance */}
                </div>
              ) : (
                <button 
                  onClick={() => {
                    setCapturedImage(null);
                    setDetectedRecords([]);
                    setError(null);
                    startCamera();
                  }}
                  className="bg-white text-black px-6 py-3 rounded-full font-bold shadow-lg"
                >
                  Retake
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results Panel */}
      {detectedRecords.length > 0 && !isAnalyzing && (
        <div className="mt-4 p-4 bg-vinyl-800 rounded-lg max-h-64 overflow-y-auto">
          <h3 className="text-vinyl-accent font-bold mb-2">Found {detectedRecords.length} Items:</h3>
          <div className="space-y-2">
            {detectedRecords.map((rec, i) => (
              <div key={i} className="flex justify-between items-center p-2 bg-vinyl-900 rounded border border-vinyl-700">
                <div>
                  <div className="font-bold">{rec.title}</div>
                  <div className="text-sm text-gray-400">{rec.artist}</div>
                </div>
                <div className="text-xs px-2 py-1 bg-green-900 text-green-300 rounded">
                  {(rec.confidence * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button 
              onClick={() => {
                setCapturedImage(null);
                setDetectedRecords([]);
                startCamera();
              }}
              className="flex-1 py-2 rounded border border-gray-600 text-gray-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button 
              onClick={handleConfirm}
              className="flex-1 py-2 rounded bg-vinyl-accent text-white font-bold hover:bg-red-500"
            >
              Add All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};