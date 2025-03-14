// File: /src/components/app-sidebar.tsx
import { Calendar, Inbox, Search } from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

const items = [
  {
    title: 'Chat',
    url: 'chat',
    icon: Inbox,
  },
  {
    title: 'Character Overview',
    url: 'character',
    icon: Calendar,
  },
  {
    title: 'Token Prediction',
    url: 'predict-token',
    icon: Search,
  },
];

export function AppSidebar() {
  const { agentId } = useParams<{ agentId: string }>();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={`/${agentId}/${item.url}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}