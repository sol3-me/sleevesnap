import React from 'react';
import { VinylRecord } from '../types';

interface VinylCardProps {
  record: VinylRecord;
  onRemove?: (id: string) => void;
}

export const VinylCard: React.FC<VinylCardProps> = ({ record, onRemove }) => {
  return (
    <div className="bg-vinyl-800 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-all border border-vinyl-700 group relative">
      <div className="relative aspect-square bg-vinyl-900">
        <img 
          src={record.coverUrl || 'https://picsum.photos/300/300'} 
          alt={`${record.title} cover`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {/* Vinyl Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none"></div>
        
        {/* Record Groove Texture Overlay (Subtle) */}
        <div className="absolute inset-0 rounded-full border-2 border-white/5 m-2 pointer-events-none opacity-50"></div>
      </div>
      
      <div className="p-4">
        <h3 className="font-bold text-lg text-white truncate" title={record.title}>{record.title}</h3>
        <p className="text-vinyl-accent font-medium truncate">{record.artist}</p>
        <div className="flex justify-between items-center mt-2 text-xs text-vinyl-muted">
          <span>{record.year || 'Unknown Year'}</span>
          <span>{record.genre || 'Genre N/A'}</span>
        </div>
      </div>

      {onRemove && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onRemove(record.id);
          }}
          className="absolute top-2 right-2 p-2 bg-red-600/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-white hover:bg-red-600"
          aria-label="Remove record"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      )}
    </div>
  );
};