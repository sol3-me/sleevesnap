import React, { useState, useEffect, useCallback } from 'react';
import { VinylRecord, ViewState, UserProfile } from './types';
import { getCollection, addRecord, removeRecord, getUser, loginUser, logoutUser } from './services/storageService';
import { searchVinylDatabase } from './services/geminiService';
import { VinylCard } from './components/VinylCard';
import { Scanner } from './components/Scanner';

// --- Reusable UI Icons ---
const Icons = {
  Home: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
  Search: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>,
  Camera: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>,
  LogOut: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>,
};

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [view, setView] = useState<ViewState>(ViewState.LOGIN);
  const [collection, setCollection] = useState<VinylRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VinylRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Initialize
  useEffect(() => {
    const existingUser = getUser();
    if (existingUser) {
      setUser(existingUser);
      getCollection().then(setCollection);
      setView(ViewState.DASHBOARD);
    }
  }, []);

  const handleLogin = (name: string) => {
    const newUser = loginUser(name);
    setUser(newUser);
    getCollection().then(setCollection);
    setView(ViewState.DASHBOARD);
    showNotification(`Welcome back, ${name}!`);
  };

  const handleLogout = () => {
    logoutUser();
    setUser(null);
    setCollection([]);
    setView(ViewState.LOGIN);
  };

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleAddToCollection = async (record: VinylRecord) => {
    const success = await addRecord(record);
    if (success) {
      setCollection(await getCollection());
      showNotification(`Added "${record.title}" to collection`);
      // If we were searching, stay there, if scanning, go to dashboard
      if (view === ViewState.SCANNER) setView(ViewState.DASHBOARD);
    } else {
      showNotification(`"${record.title}" is already in your collection`);
    }
  };

  const handleRemoveFromCollection = async (id: string) => {
    await removeRecord(id);
    setCollection(await getCollection());
    showNotification("Record removed");
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const results = await searchVinylDatabase(searchQuery);
    setSearchResults(results);
    setIsSearching(false);
  };

  // --- Views ---

  const LoginView = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-br from-vinyl-900 via-black to-vinyl-800">
      <div className="w-full max-w-md bg-vinyl-800 p-8 rounded-2xl shadow-2xl border border-vinyl-700">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-vinyl-accent rounded-full flex items-center justify-center animate-spin-slow shadow-[0_0_20px_rgba(255,107,107,0.3)]">
            <div className="w-8 h-8 bg-vinyl-900 rounded-full"></div>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-center mb-2 text-white">sleevesnap</h1>
        <p className="text-center text-gray-400 mb-8">Digitize your vinyl collection with AI.</p>
        
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          handleLogin(fd.get('name') as string || 'Guest');
        }}>
          <input 
            name="name"
            type="text" 
            placeholder="Enter your name" 
            className="w-full bg-vinyl-900 text-white border border-vinyl-700 rounded-lg p-3 mb-4 focus:ring-2 focus:ring-vinyl-accent focus:outline-none transition-all"
            required
          />
          <button 
            type="submit"
            className="w-full bg-vinyl-accent hover:bg-red-500 text-white font-bold py-3 rounded-lg transition-colors shadow-lg"
          >
            Start Collecting
          </button>
        </form>
      </div>
    </div>
  );

  const DashboardView = () => (
    <div className="p-4 md:p-8 pb-24">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white">Your Collection</h2>
          <p className="text-gray-400">{collection.length} Records</p>
        </div>
        <button 
          onClick={() => setView(ViewState.SCANNER)}
          className="md:hidden bg-vinyl-accent text-white p-3 rounded-full shadow-lg"
        >
          <Icons.Camera />
        </button>
      </div>

      {collection.length === 0 ? (
        <div className="text-center py-20 bg-vinyl-800/50 rounded-xl border border-dashed border-vinyl-700">
          <p className="text-xl text-gray-400 mb-4">It's quiet in here...</p>
          <button 
            onClick={() => setView(ViewState.SEARCH)}
            className="text-vinyl-accent underline hover:text-white"
          >
            Add your first record
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {collection.map(record => (
            <VinylCard key={record.id} record={record} onRemove={handleRemoveFromCollection} />
          ))}
        </div>
      )}
    </div>
  );

  const SearchView = () => (
    <div className="p-4 md:p-8 pb-24">
      <h2 className="text-3xl font-bold text-white mb-6">Discover Vinyl</h2>
      <div className="flex gap-2 mb-8">
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search artist, album, or genre..."
          className="flex-1 bg-vinyl-800 text-white border border-vinyl-700 rounded-lg p-3 focus:ring-1 focus:ring-vinyl-accent focus:outline-none"
        />
        <button 
          onClick={handleSearch}
          disabled={isSearching}
          className="bg-vinyl-700 hover:bg-vinyl-600 text-white px-6 rounded-lg transition-colors font-medium disabled:opacity-50"
        >
          {isSearching ? '...' : 'Search'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {searchResults.map((record) => (
          <div key={record.id} className="flex bg-vinyl-800 rounded-lg overflow-hidden border border-vinyl-700">
             <img 
              src={record.coverUrl} 
              alt={record.title}
              className="w-24 h-24 object-cover"
            />
            <div className="p-3 flex-1 flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-white truncate">{record.title}</h4>
                <p className="text-sm text-gray-400">{record.artist}</p>
              </div>
              <button 
                onClick={() => handleAddToCollection(record)}
                className="self-end text-xs bg-vinyl-accent hover:bg-red-500 text-white px-3 py-1 rounded transition-colors"
              >
                Add to Collection
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {!isSearching && searchResults.length === 0 && searchQuery && (
        <div className="text-center text-gray-500 mt-10">No results found. Try a different query.</div>
      )}
    </div>
  );

  // --- Main Layout Render ---

  if (!user || view === ViewState.LOGIN) {
    return <LoginView />;
  }

  return (
    <div className="flex h-screen bg-vinyl-900 text-white overflow-hidden">
      
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex flex-col w-64 bg-vinyl-800 border-r border-vinyl-700">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-vinyl-accent flex items-center gap-2">
            <span className="w-3 h-3 bg-white rounded-full"></span>
            sleevesnap
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setView(ViewState.DASHBOARD)}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition-all ${view === ViewState.DASHBOARD ? 'bg-vinyl-accent text-white' : 'text-gray-400 hover:bg-vinyl-700'}`}
          >
            <Icons.Home /> Home
          </button>
          <button 
            onClick={() => setView(ViewState.SEARCH)}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition-all ${view === ViewState.SEARCH ? 'bg-vinyl-accent text-white' : 'text-gray-400 hover:bg-vinyl-700'}`}
          >
            <Icons.Search /> Search
          </button>
           <button 
            onClick={() => setView(ViewState.SCANNER)}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition-all ${view === ViewState.SCANNER ? 'bg-vinyl-accent text-white' : 'text-gray-400 hover:bg-vinyl-700'}`}
          >
            <Icons.Camera /> Scan
          </button>
        </nav>
        <div className="p-4 border-t border-vinyl-700">
          <div className="flex items-center gap-3 mb-4">
             <img src={user.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full bg-gray-600" />
             <div className="flex-1 overflow-hidden">
               <p className="text-sm font-bold truncate">{user.name}</p>
               <p className="text-xs text-gray-500 truncate">{user.email}</p>
             </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300">
            <Icons.LogOut /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative overflow-y-auto h-full scroll-smooth">
        
        {/* Mobile Header */}
        <header className="md:hidden flex justify-between items-center p-4 bg-vinyl-800/90 backdrop-blur-md sticky top-0 z-20 border-b border-vinyl-700">
          <h1 className="text-xl font-bold text-vinyl-accent">sleevesnap</h1>
          <img src={user.avatarUrl} alt="User" className="w-8 h-8 rounded-full" />
        </header>

        {/* Dynamic View */}
        {view === ViewState.SCANNER ? (
          <Scanner 
            onCancel={() => setView(ViewState.DASHBOARD)} 
            onScanComplete={async (records) => {
              await Promise.all(records.map(r => addRecord(r)));
              setCollection(await getCollection());
              setView(ViewState.DASHBOARD);
              showNotification(`Added ${records.length} records!`);
            }}
          />
        ) : view === ViewState.SEARCH ? (
          <SearchView />
        ) : (
          <DashboardView />
        )}

        {/* Mobile Navigation Bar (Bottom Sticky) */}
        {view !== ViewState.SCANNER && (
          <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-vinyl-800 border-t border-vinyl-700 flex justify-around p-3 z-30 pb-safe">
            <button onClick={() => setView(ViewState.DASHBOARD)} className={`flex flex-col items-center ${view === ViewState.DASHBOARD ? 'text-vinyl-accent' : 'text-gray-500'}`}>
              <Icons.Home />
              <span className="text-xs mt-1">Home</span>
            </button>
            <button onClick={() => setView(ViewState.SCANNER)} className="flex flex-col items-center -mt-8">
              <div className="bg-vinyl-accent p-4 rounded-full shadow-lg border-4 border-vinyl-900 text-white">
                <Icons.Camera />
              </div>
            </button>
            <button onClick={() => setView(ViewState.SEARCH)} className={`flex flex-col items-center ${view === ViewState.SEARCH ? 'text-vinyl-accent' : 'text-gray-500'}`}>
              <Icons.Search />
              <span className="text-xs mt-1">Search</span>
            </button>
          </nav>
        )}

        {/* Global Notification Toast */}
        {notification && (
          <div className="fixed top-20 right-4 md:bottom-8 md:top-auto md:right-8 bg-white text-black px-6 py-3 rounded-lg shadow-xl animate-bounce z-50 font-medium">
            {notification}
          </div>
        )}
      </main>
    </div>
  );
}