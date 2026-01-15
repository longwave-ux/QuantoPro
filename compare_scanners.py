"""
Scanner Comparison Tool
Compares output between old and canonical scanners to validate equivalence.
"""

import sys
import json
import subprocess
import argparse
from typing import Dict, Any, List, Tuple


def run_scanner(scanner_script: str, data_file: str, strategy: str, config: str = '{}') -> List[Dict[str, Any]]:
    """Run a scanner and return parsed results."""
    try:
        cmd = [
            'python',
            scanner_script,
            data_file,
            '--strategy', strategy,
            '--config', config
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode != 0:
            print(f"Error running {scanner_script}:", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            return []
        
        # Parse JSON output
        output = result.stdout.strip()
        if not output:
            return []
        
        results = json.loads(output)
        return results if isinstance(results, list) else [results]
    
    except subprocess.TimeoutExpired:
        print(f"Timeout running {scanner_script}", file=sys.stderr)
        return []
    except json.JSONDecodeError as e:
        print(f"JSON parse error for {scanner_script}: {e}", file=sys.stderr)
        print(f"Output: {result.stdout[:500]}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"Error running {scanner_script}: {e}", file=sys.stderr)
        return []


def compare_results(old_results: List[Dict], new_results: List[Dict]) -> Dict[str, Any]:
    """Compare results from old and new scanners."""
    comparison = {
        'total_old': len(old_results),
        'total_new': len(new_results),
        'differences': [],
        'score_variance': [],
        'missing_fields': [],
        'new_fields': [],
        'status': 'UNKNOWN'
    }
    
    # Group by strategy name
    old_by_strategy = {r.get('strategy_name', 'Unknown'): r for r in old_results}
    new_by_strategy = {r.get('strategy_name', 'Unknown'): r for r in new_results}
    
    # Compare each strategy
    for strategy_name in set(list(old_by_strategy.keys()) + list(new_by_strategy.keys())):
        old_result = old_by_strategy.get(strategy_name)
        new_result = new_by_strategy.get(strategy_name)
        
        if old_result is None:
            comparison['differences'].append({
                'strategy': strategy_name,
                'issue': 'Missing in old scanner',
                'severity': 'INFO'
            })
            continue
        
        if new_result is None:
            comparison['differences'].append({
                'strategy': strategy_name,
                'issue': 'Missing in new scanner',
                'severity': 'ERROR'
            })
            continue
        
        # Compare scores
        old_score = old_result.get('score', 0)
        new_score = new_result.get('score', 0)
        
        if old_score > 0:
            variance_pct = abs(new_score - old_score) / old_score * 100
        else:
            variance_pct = 0 if new_score == 0 else 100
        
        comparison['score_variance'].append({
            'strategy': strategy_name,
            'old_score': old_score,
            'new_score': new_score,
            'variance_pct': variance_pct
        })
        
        # Check for significant variance (> 15%)
        if variance_pct > 15:
            comparison['differences'].append({
                'strategy': strategy_name,
                'issue': f'Score variance {variance_pct:.1f}%',
                'old_score': old_score,
                'new_score': new_score,
                'severity': 'WARNING' if variance_pct < 30 else 'ERROR'
            })
        
        # Compare bias
        old_bias = old_result.get('bias', 'NONE')
        new_bias = new_result.get('bias', 'NONE')
        
        if old_bias != new_bias:
            comparison['differences'].append({
                'strategy': strategy_name,
                'issue': 'Bias mismatch',
                'old_bias': old_bias,
                'new_bias': new_bias,
                'severity': 'WARNING'
            })
        
        # Check for new fields in canonical output
        old_fields = set(old_result.keys())
        new_fields = set(new_result.keys())
        
        added_fields = new_fields - old_fields
        if added_fields:
            comparison['new_fields'].extend([
                {'strategy': strategy_name, 'field': f} for f in added_fields
            ])
        
        missing_fields = old_fields - new_fields
        if missing_fields:
            comparison['missing_fields'].extend([
                {'strategy': strategy_name, 'field': f} for f in missing_fields
            ])
    
    # Determine overall status
    has_errors = any(d['severity'] == 'ERROR' for d in comparison['differences'])
    has_warnings = any(d['severity'] == 'WARNING' for d in comparison['differences'])
    
    if has_errors:
        comparison['status'] = 'FAILED'
    elif has_warnings:
        comparison['status'] = 'WARNING'
    else:
        comparison['status'] = 'PASSED'
    
    return comparison


def print_comparison(comparison: Dict[str, Any], verbose: bool = False):
    """Print comparison results in a readable format."""
    print("\n" + "=" * 70)
    print("Scanner Comparison Results")
    print("=" * 70)
    
    # Summary
    print(f"\nResults Count:")
    print(f"  Old Scanner: {comparison['total_old']} signals")
    print(f"  New Scanner: {comparison['total_new']} signals")
    
    # Score variance
    if comparison['score_variance']:
        print(f"\nScore Comparison:")
        for sv in comparison['score_variance']:
            variance_str = f"{sv['variance_pct']:.1f}%"
            status_icon = "✓" if sv['variance_pct'] <= 15 else "⚠" if sv['variance_pct'] <= 30 else "✗"
            print(f"  {status_icon} {sv['strategy']}: {sv['old_score']:.1f} → {sv['new_score']:.1f} (Δ {variance_str})")
    
    # New fields (expected)
    if comparison['new_fields'] and verbose:
        print(f"\nNew Fields Added (Expected):")
        seen = set()
        for nf in comparison['new_fields']:
            if nf['field'] not in seen:
                print(f"  + {nf['field']}")
                seen.add(nf['field'])
    
    # Missing fields (potential issue)
    if comparison['missing_fields']:
        print(f"\nMissing Fields (Potential Issue):")
        seen = set()
        for mf in comparison['missing_fields']:
            if mf['field'] not in seen:
                print(f"  - {mf['field']}")
                seen.add(mf['field'])
    
    # Differences
    if comparison['differences']:
        print(f"\nDifferences Detected:")
        for diff in comparison['differences']:
            severity_icon = {
                'ERROR': '✗',
                'WARNING': '⚠',
                'INFO': 'ℹ'
            }.get(diff['severity'], '?')
            
            print(f"  {severity_icon} [{diff['severity']}] {diff['strategy']}: {diff['issue']}")
            
            if verbose:
                for key, value in diff.items():
                    if key not in ['strategy', 'issue', 'severity']:
                        print(f"      {key}: {value}")
    
    # Overall status
    print(f"\n" + "=" * 70)
    status_icon = {
        'PASSED': '✓',
        'WARNING': '⚠',
        'FAILED': '✗',
        'UNKNOWN': '?'
    }.get(comparison['status'], '?')
    
    print(f"Overall Status: {status_icon} {comparison['status']}")
    print("=" * 70 + "\n")
    
    # Recommendations
    if comparison['status'] == 'PASSED':
        print("✓ Canonical scanner produces equivalent results.")
        print("  Safe to proceed with migration.")
    elif comparison['status'] == 'WARNING':
        print("⚠ Minor differences detected.")
        print("  Review warnings above. May be acceptable variance.")
    else:
        print("✗ Significant differences detected.")
        print("  Review errors above before migration.")


def main():
    parser = argparse.ArgumentParser(description='Compare old and canonical scanners')
    parser.add_argument('data_file', help='Input data file (e.g., data/HYPERLIQUID_BTCUSDT_15m.json)')
    parser.add_argument('--strategy', default='all', help='Strategy to test (default: all)')
    parser.add_argument('--config', default='{}', help='JSON config string')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    
    args = parser.parse_args()
    
    print(f"Comparing scanners for: {args.data_file}")
    print(f"Strategy: {args.strategy}")
    print(f"Config: {args.config}")
    
    # Run old scanner
    print("\nRunning old scanner...", file=sys.stderr)
    old_results = run_scanner('market_scanner.py', args.data_file, args.strategy, args.config)
    print(f"Old scanner: {len(old_results)} results", file=sys.stderr)
    
    # Run new scanner
    print("Running canonical scanner...", file=sys.stderr)
    new_results = run_scanner('market_scanner_refactored.py', args.data_file, args.strategy, args.config)
    print(f"Canonical scanner: {len(new_results)} results", file=sys.stderr)
    
    # Compare
    comparison = compare_results(old_results, new_results)
    
    # Output
    if args.json:
        print(json.dumps(comparison, indent=2))
    else:
        print_comparison(comparison, args.verbose)
    
    # Exit code
    exit_code = {
        'PASSED': 0,
        'WARNING': 0,
        'FAILED': 1,
        'UNKNOWN': 2
    }.get(comparison['status'], 2)
    
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
