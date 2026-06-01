import React, { useState, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppV2 from './AppV2.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { this.setState({ error, errorInfo }); }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ color: '#ef4444', margin: 20, fontFamily: 'monospace' }}>
                    <h2>Something went wrong.</h2>
                    <pre style={{ fontSize: 12, color: '#f87171' }}>{this.state.error?.toString()}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

function Root() {
    const [version, setVersion] = useState(
        () => localStorage.getItem('astraeus_version') || 'v1'
    );

    const switchToV2 = useCallback(() => {
        localStorage.setItem('astraeus_version', 'v2');
        setVersion('v2');
    }, []);

    const switchToV1 = useCallback(() => {
        localStorage.setItem('astraeus_version', 'v1');
        setVersion('v1');
    }, []);

    return (
        <ErrorBoundary>
            {version === 'v2'
                ? <AppV2 onSwitchToV1={switchToV1} />
                : <App   onSwitchToV2={switchToV2} />
            }
        </ErrorBoundary>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode><Root /></React.StrictMode>
);
