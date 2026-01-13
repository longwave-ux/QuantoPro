import json
import os
import glob
import pandas as pd
import re

# Configurazione
DATA_DIR = './data'
SOURCE_PRIORITY = {
    'HYPERLIQUID': 100,
    'BINANCE': 90,
    'BYBIT': 80,
    'OKX': 70,
    'KUCOIN': 60,
    'MEXC': 50
}

def get_base_symbol(symbol):
    """
    Rimuove suffissi comuni per trovare il 'vero' nome della coin.
    Es: BTCUSDT -> BTC, PEPEUSDTM -> PEPE
    """
    # Rimuovi suffissi comuni in ordine di lunghezza
    for suffix in ['USDTM', 'PERP', 'USDT', 'USD']:
        if symbol.endswith(suffix):
            return symbol[:-len(suffix)]
    return symbol

def load_all_results():
    all_signals = []
    pattern = os.path.join(DATA_DIR, 'latest_results_*.json')
    files = glob.glob(pattern)
    
    print(f"[*] Trovati {len(files)} file di risultati.")
    
    for fpath in files:
        try:
            filename = os.path.basename(fpath)
            # Estrai il nome dell'exchange dal file se possibile (es. latest_results_MEXC.json)
            source_guess = "UNKNOWN"
            if "latest_results_" in filename:
                source_guess = filename.replace("latest_results_", "").replace(".json", "")
            
            with open(fpath, 'r') as f:
                data = json.load(f)
                
            if isinstance(data, list):
                for item in data:
                    # Assicurati che il campo 'source' esista, altrimenti usa quello del filename
                    if 'source' not in item or not item['source']:
                        item['source'] = source_guess
                    all_signals.append(item)
        except Exception as e:
            print(f"[!] Errore leggendo {fpath}: {e}")
            
    return all_signals

def main():
    raw_signals = load_all_results()
    print(f"[*] Totale segnali grezzi caricati: {len(raw_signals)}")
    
    # 1. Mappa dei Volumi (Simbolo + Exchange -> Volume)
    # Cerchiamo i volumi nelle strategie che li hanno (es. Legacy)
    vol_map = {} # Key: source_symbol, Value: vol24h
    
    for s in raw_signals:
        src = s.get('source', 'UNKNOWN')
        sym = s.get('symbol', 'UNKNOWN')
        key = f"{src}_{sym}"
        
        # Cerca volume nei dettagli
        vol = 0
        if 'details' in s and 'vol24h' in s['details']:
            vol = float(s['details']['vol24h'] or 0)
        
        # Aggiorna la mappa se troviamo un volume valido
        if vol > 0:
            # Se abbiamo già un volume per questa coppia, teniamo il più aggiornato/alto
            if key not in vol_map or vol > vol_map[key]:
                vol_map[key] = vol

    # 2. Arricchimento e Normalizzazione
    processed_signals = []
    for s in raw_signals:
        src = s.get('source', 'UNKNOWN')
        sym = s.get('symbol', 'UNKNOWN')
        key = f"{src}_{sym}"
        
        # Recupera volume dalla mappa (se non c'era nel segnale specifico, magari c'era nel Legacy dello stesso exchange)
        vol = 0
        if 'details' in s and 'vol24h' in s['details'] and s['details']['vol24h']:
             vol = float(s['details']['vol24h'])
        
        if vol == 0 and key in vol_map:
            vol = vol_map[key]
            
        base_sym = get_base_symbol(sym)
        
        s['enrich_vol'] = vol
        s['base_symbol'] = base_sym
        s['priority_score'] = SOURCE_PRIORITY.get(src, 0)
        processed_signals.append(s)

    # 3. Deduplicazione (Grouping)
    # Chiave univoca: Strategia + Simbolo Base (es. "Breakout_BTC")
    grouped = {}
    
    for s in processed_signals:
        strat = s.get('strategy_name', 'Unknown')
        base = s['base_symbol']
        group_key = f"{strat}|{base}"
        
        if group_key not in grouped:
            grouped[group_key] = []
        grouped[group_key].append(s)
        
    # 4. Selezione del "Best Candidate"
    final_list = []
    
    print("\n--- PROCESSO DI AGGREGAZIONE ---")
    for group_key, candidates in grouped.items():
        # Ordina per: 
        # 1. Volume (Decrescente)
        # 2. Priorità Exchange (Decrescente)
        # 3. Score (Decrescente) - come tie breaker finale
        
        candidates.sort(key=lambda x: (x['enrich_vol'], x['priority_score'], x['score']), reverse=True)
        
        winner = candidates[0]
        
        # Logica di debug per vedere chi vince
        if len(candidates) > 1:
            strat, base = group_key.split('|')
            # print(f"Deduplicato {base} ({strat}): Vincente {winner['source']} (Vol: {winner['enrich_vol']:,.0f}) su {len(candidates)} candidati.")
            pass
            
        final_list.append(winner)

    # 5. Output Tabellare
    print(f"\n[*] Segnali unici finali: {len(final_list)}")
    
    # Creiamo un DataFrame per visualizzare bene
    df = pd.DataFrame(final_list)
    
    if not df.empty:
        # Formattiamo PRIMA di filtrare
        df['Formatted_Vol'] = df['enrich_vol'].apply(lambda x: f"${x:,.0f}" if x > 0 else "N/A")
        
        # Definiamo le colonne che vogliamo vedere (includendo quella nuova)
        cols_to_show = ['strategy_name', 'base_symbol', 'source', 'action', 'score', 'price', 'Formatted_Vol']
        
        # Ordiniamo usando i dati numerici originali ('enrich_vol')
        df = df.sort_values(by=['score', 'enrich_vol'], ascending=False)
        
        # Creiamo la vista finale
        view = df[cols_to_show]
        view.columns = ['Strategy', 'Symbol', 'Source', 'Action', 'Score', 'Price', 'Volume (24h)']
        
        # Stampa a video
        print("\nTOP 20 OPPORTUNITÀ (AGGREGATE & PULITE):")
        print(view.head(20).to_string(index=False))
        
        # Salva un JSON pulito di test (con i dati grezzi, non formattati)
        with open('data/aggregated_master_test.json', 'w') as f:
            json.dump(final_list, f, indent=2)
        print("\n[OK] Risultato salvato in 'data/aggregated_master_test.json'")
    else:
        print("[!] Nessun segnale trovato.")

if __name__ == "__main__":
    main()