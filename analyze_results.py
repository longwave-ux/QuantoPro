import json

try:
    with open('backtest_results_filtered.json', 'r') as f:
        data = json.load(f)

    if not data:
        print("No signals found.")
        exit()

    total = len(data)
    scores = [d['score'] for d in data]
    avg_score = sum(scores) / total
    god_mode = len([s for s in scores if s >= 100])
    
    rrs = [d['rr'] for d in data if d['rr'] is not None]
    avg_rr = sum(rrs) / len(rrs) if rrs else 0.0
    
    # Best signal: highest score, then highest RR
    best_signal = sorted(data, key=lambda x: (x['score'], x['rr']), reverse=True)[0]

    print(f"Total Signals: {total}")
    print(f"Average Score: {avg_score:.2f}")
    print(f"God Mode Count (>=100): {god_mode}")
    print(f"Avg Risk:Reward: {avg_rr:.2f}")
    print("\nBest Signal Example:")
    print(json.dumps(best_signal, indent=2))

except Exception as e:
    print(f"Error analyzing: {e}")
