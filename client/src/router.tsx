// File: /src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import Agents from './Agents';
import Agent from './Agent';
import Layout from './Layout';
import Chat from './Chat';
import Character from './Character';
import TokenPrediction from './components/TokenPrediction';
import { TokenPredictionDashboard } from './components/TokenPredictionDashboard';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Agents />,
  },
  {
    path: '/:agentId',
    element: <Layout />,
    children: [
      {
        path: '',
        element: <Agent />,
      },
      {
        path: 'chat',
        element: <Chat />,
      },
      {
        path: 'character',
        element: <Character />,
      },
      {
        path: 'predict-token',
        element: <TokenPrediction />,
      },
      {
        path: 'token-dashboard',
        element: <TokenPredictionDashboard />,
      },
    ],
  },
]);