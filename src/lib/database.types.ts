
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "app_users": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"deleted_at": string | null,"display_name": string,"email": string,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"display_name": string,"email": string,"id"?: string,"role": Database["public"]['Enums']["app_role"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"display_name"?: string,"email"?: string,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"after": Json | null,"at": string,"before": Json | null,"id": number,"row_id": string | null,"table_name": string,"user_email": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"after"?: Json | null,"at"?: string,"before"?: Json | null,"id"?: never,"row_id"?: string | null,"table_name": string,"user_email"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"after"?: Json | null,"at"?: string,"before"?: Json | null,"id"?: never,"row_id"?: string | null,"table_name"?: string,"user_email"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"bank_balances": {
                  Row: {
                    "amount": number,"balance_date": string,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"id": string,"notes": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"balance_date": string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"id"?: string,"notes"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"balance_date"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"id"?: string,"notes"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"booking_lines": {
                  Row: {
                    "amount": number,"booking_id": string,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"discount_subtype": Database["public"]['Enums']["discount_subtype"] | null,"id": string,"import_key": string | null,"is_actual_fee": boolean,"is_estimate": boolean,"kind": Database["public"]['Enums']["line_kind"],"label": string,"qty": number,"sort_order": number,"unit_amount": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"booking_id": string,"created_at"?: string,"created_by"?: string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"discount_subtype"?: Database["public"]['Enums']["discount_subtype"] | null,"id"?: string,"import_key"?: string | null,"is_actual_fee"?: boolean,"is_estimate"?: boolean,"kind": Database["public"]['Enums']["line_kind"],"label": string,"qty"?: number,"sort_order"?: number,"unit_amount": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"booking_id"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"discount_subtype"?: Database["public"]['Enums']["discount_subtype"] | null,"id"?: string,"import_key"?: string | null,"is_actual_fee"?: boolean,"is_estimate"?: boolean,"kind"?: Database["public"]['Enums']["line_kind"],"label"?: string,"qty"?: number,"sort_order"?: number,"unit_amount"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_lines_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "booking_lines_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "booking_lines_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "booked_at": string | null,"booking_type": Database["public"]['Enums']["booking_type"],"cancellation_reason": string | null,"cancelled_on": string | null,"channel_id": string,"check_in": string,"check_out": string,"checkin_notes": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"guest_count": number | null,"guest_id": string | null,"ical_phone_last4": string | null,"ical_uid": string | null,"id": string,"import_key": string | null,"needs_details": boolean,"nights": number | null,"notes": string | null,"possibly_cancelled_at": string | null,"ref": string | null,"source": Database["public"]['Enums']["record_source"],"status": Database["public"]['Enums']["booking_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booked_at"?: string | null,"booking_type"?: Database["public"]['Enums']["booking_type"],"cancellation_reason"?: string | null,"cancelled_on"?: string | null,"channel_id": string,"check_in": string,"check_out": string,"checkin_notes"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"guest_count"?: number | null,"guest_id"?: string | null,"ical_phone_last4"?: string | null,"ical_uid"?: string | null,"id"?: string,"import_key"?: string | null,"needs_details"?: boolean,"nights"?: never,"notes"?: string | null,"possibly_cancelled_at"?: string | null,"ref"?: string | null,"source"?: Database["public"]['Enums']["record_source"],"status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booked_at"?: string | null,"booking_type"?: Database["public"]['Enums']["booking_type"],"cancellation_reason"?: string | null,"cancelled_on"?: string | null,"channel_id"?: string,"check_in"?: string,"check_out"?: string,"checkin_notes"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"guest_count"?: number | null,"guest_id"?: string | null,"ical_phone_last4"?: string | null,"ical_uid"?: string | null,"id"?: string,"import_key"?: string | null,"needs_details"?: boolean,"nights"?: never,"notes"?: string | null,"possibly_cancelled_at"?: string | null,"ref"?: string | null,"source"?: Database["public"]['Enums']["record_source"],"status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_guest_id_fkey"
      columns: ["guest_id"]
isOneToOne: false
      referencedRelation: "guests"
      referencedColumns: ["id"]
    }
                  ]
                },"calendar_blocks": {
                  Row: {
                    "channel_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"end_date": string,"external_uid": string | null,"id": string,"notes": string | null,"possibly_removed_at": string | null,"reason": Database["public"]['Enums']["block_reason"],"source": Database["public"]['Enums']["record_source"],"start_date": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"end_date": string,"external_uid"?: string | null,"id"?: string,"notes"?: string | null,"possibly_removed_at"?: string | null,"reason": Database["public"]['Enums']["block_reason"],"source"?: Database["public"]['Enums']["record_source"],"start_date": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "channel_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"end_date"?: string,"external_uid"?: string | null,"id"?: string,"notes"?: string | null,"possibly_removed_at"?: string | null,"reason"?: Database["public"]['Enums']["block_reason"],"source"?: Database["public"]['Enums']["record_source"],"start_date"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_blocks_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    }
                  ]
                },"capital_movements": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"id": string,"import_key": string | null,"mode": string | null,"movement_date": string,"notes": string | null,"partner_id": string,"type": Database["public"]['Enums']["capital_type"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"id"?: string,"import_key"?: string | null,"mode"?: string | null,"movement_date": string,"notes"?: string | null,"partner_id": string,"type": Database["public"]['Enums']["capital_type"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"id"?: string,"import_key"?: string | null,"mode"?: string | null,"movement_date"?: string,"notes"?: string | null,"partner_id"?: string,"type"?: Database["public"]['Enums']["capital_type"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "capital_movements_partner_id_fkey"
      columns: ["partner_id"]
isOneToOne: false
      referencedRelation: "partner_capital"
      referencedColumns: ["partner_id"]
    },{
      foreignKeyName: "capital_movements_partner_id_fkey"
      columns: ["partner_id"]
isOneToOne: false
      referencedRelation: "partners"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_secrets": {
                  Row: {
                    "channel_id": string,"ical_url": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"ical_url"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "channel_id"?: string,"ical_url"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_secrets_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: true
      referencedRelation: "channels"
      referencedColumns: ["id"]
    }
                  ]
                },"channels": {
                  Row: {
                    "code": string,"color": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"ical_configured": boolean,"id": string,"name": string,"native_currency": Database["public"]['Enums']["currency_code"],"platform_fee_pct": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"color"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"ical_configured"?: boolean,"id"?: string,"name": string,"native_currency"?: Database["public"]['Enums']["currency_code"],"platform_fee_pct"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "code"?: string,"color"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"ical_configured"?: boolean,"id"?: string,"name"?: string,"native_currency"?: Database["public"]['Enums']["currency_code"],"platform_fee_pct"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"csv_mappings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"header_signature": string,"id": string,"mapping": NonNullable<Json>,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"header_signature": string,"id"?: string,"mapping": NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"header_signature"?: string,"id"?: string,"mapping"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"doc_counters": {
                  Row: {
                    "last_value": number,"prefix": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_value"?: number,"prefix": string,"year": number
                  }
                  Update: {
                    "last_value"?: number,"prefix"?: string,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"booking_id": string | null,"budget_amount": number | null,"category": string,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"expense_date": string,"id": string,"import_key": string | null,"item": string,"kind": Database["public"]['Enums']["expense_kind"],"notes": string | null,"paid_by_partner_id": string | null,"paid_date": string | null,"period": string | null,"receipt_path": string | null,"recurring_template_id": string | null,"reimbursable": boolean,"reimbursed_date": string | null,"status": Database["public"]['Enums']["expense_status"],"updated_at": string,"updated_by": string | null,"vendor": string | null,"vendor_quote_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"booking_id"?: string | null,"budget_amount"?: number | null,"category": string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"expense_date": string,"id"?: string,"import_key"?: string | null,"item": string,"kind": Database["public"]['Enums']["expense_kind"],"notes"?: string | null,"paid_by_partner_id"?: string | null,"paid_date"?: string | null,"period"?: string | null,"receipt_path"?: string | null,"recurring_template_id"?: string | null,"reimbursable"?: boolean,"reimbursed_date"?: string | null,"status"?: Database["public"]['Enums']["expense_status"],"updated_at"?: string,"updated_by"?: string | null,"vendor"?: string | null,"vendor_quote_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"booking_id"?: string | null,"budget_amount"?: number | null,"category"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"expense_date"?: string,"id"?: string,"import_key"?: string | null,"item"?: string,"kind"?: Database["public"]['Enums']["expense_kind"],"notes"?: string | null,"paid_by_partner_id"?: string | null,"paid_date"?: string | null,"period"?: string | null,"receipt_path"?: string | null,"recurring_template_id"?: string | null,"reimbursable"?: boolean,"reimbursed_date"?: string | null,"status"?: Database["public"]['Enums']["expense_status"],"updated_at"?: string,"updated_by"?: string | null,"vendor"?: string | null,"vendor_quote_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "expenses_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "expenses_paid_by_partner_id_fkey"
      columns: ["paid_by_partner_id"]
isOneToOne: false
      referencedRelation: "partner_capital"
      referencedColumns: ["partner_id"]
    },{
      foreignKeyName: "expenses_paid_by_partner_id_fkey"
      columns: ["paid_by_partner_id"]
isOneToOne: false
      referencedRelation: "partners"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_recurring_template_id_fkey"
      columns: ["recurring_template_id"]
isOneToOne: false
      referencedRelation: "recurring_expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_vendor_quote_id_fkey"
      columns: ["vendor_quote_id"]
isOneToOne: false
      referencedRelation: "vendor_balances"
      referencedColumns: ["vendor_quote_id"]
    },{
      foreignKeyName: "expenses_vendor_quote_id_fkey"
      columns: ["vendor_quote_id"]
isOneToOne: false
      referencedRelation: "vendor_quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"feed_tokens": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"kind": Database["public"]['Enums']["feed_kind"],"label": string,"revoked_at": string | null,"token_hash": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["feed_kind"],"label": string,"revoked_at"?: string | null,"token_hash": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["feed_kind"],"label"?: string,"revoked_at"?: string | null,"token_hash"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"guests": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"email": string | null,"id": string,"import_key": string | null,"name": string,"notes": string | null,"phone": string | null,"source": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"import_key"?: string | null,"name": string,"notes"?: string | null,"phone"?: string | null,"source"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"import_key"?: string | null,"name"?: string,"notes"?: string | null,"phone"?: string | null,"source"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"inquiries": {
                  Row: {
                    "booking_id": string | null,"channel_id": string | null,"check_in": string | null,"check_out": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"follow_up_date": string | null,"guest_count": number | null,"guest_id": string | null,"id": string,"lost_reason": string | null,"notes": string | null,"quote_id": string | null,"scope": Database["public"]['Enums']["stay_scope"],"status": Database["public"]['Enums']["inquiry_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"channel_id"?: string | null,"check_in"?: string | null,"check_out"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"follow_up_date"?: string | null,"guest_count"?: number | null,"guest_id"?: string | null,"id"?: string,"lost_reason"?: string | null,"notes"?: string | null,"quote_id"?: string | null,"scope"?: Database["public"]['Enums']["stay_scope"],"status"?: Database["public"]['Enums']["inquiry_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"channel_id"?: string | null,"check_in"?: string | null,"check_out"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"follow_up_date"?: string | null,"guest_count"?: number | null,"guest_id"?: string | null,"id"?: string,"lost_reason"?: string | null,"notes"?: string | null,"quote_id"?: string | null,"scope"?: Database["public"]['Enums']["stay_scope"],"status"?: Database["public"]['Enums']["inquiry_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inquiries_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "inquiries_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "inquiries_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_guest_id_fkey"
      columns: ["guest_id"]
isOneToOne: false
      referencedRelation: "guests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"partners": {
                  Row: {
                    "agreed_share_pct": number,"app_user_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"email": string | null,"id": string,"name": string,"sort_order": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agreed_share_pct": number,"app_user_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"name": string,"sort_order"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "agreed_share_pct"?: number,"app_user_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "partners_app_user_id_fkey"
      columns: ["app_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_due": number | null,"amount_received": number | null,"booking_id": string | null,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"due_date": string | null,"external_ref": string | null,"forwarded_date": string | null,"fx_rate": number | null,"id": string,"import_key": string | null,"is_estimate": boolean,"kind": Database["public"]['Enums']["payment_kind"],"method": Database["public"]['Enums']["payment_method"] | null,"notes": string | null,"pkr_received": number | null,"proof_path": string | null,"received_by_partner_id": string | null,"received_date": string | null,"status": Database["public"]['Enums']["payment_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_due"?: number | null,"amount_received"?: number | null,"booking_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"due_date"?: string | null,"external_ref"?: string | null,"forwarded_date"?: string | null,"fx_rate"?: number | null,"id"?: string,"import_key"?: string | null,"is_estimate"?: boolean,"kind": Database["public"]['Enums']["payment_kind"],"method"?: Database["public"]['Enums']["payment_method"] | null,"notes"?: string | null,"pkr_received"?: number | null,"proof_path"?: string | null,"received_by_partner_id"?: string | null,"received_date"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount_due"?: number | null,"amount_received"?: number | null,"booking_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"due_date"?: string | null,"external_ref"?: string | null,"forwarded_date"?: string | null,"fx_rate"?: number | null,"id"?: string,"import_key"?: string | null,"is_estimate"?: boolean,"kind"?: Database["public"]['Enums']["payment_kind"],"method"?: Database["public"]['Enums']["payment_method"] | null,"notes"?: string | null,"pkr_received"?: number | null,"proof_path"?: string | null,"received_by_partner_id"?: string | null,"received_date"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "payments_received_by_partner_id_fkey"
      columns: ["received_by_partner_id"]
isOneToOne: false
      referencedRelation: "partner_capital"
      referencedColumns: ["partner_id"]
    },{
      foreignKeyName: "payments_received_by_partner_id_fkey"
      columns: ["received_by_partner_id"]
isOneToOne: false
      referencedRelation: "partners"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_lines": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"deleted_at": string | null,"discount_subtype": Database["public"]['Enums']["discount_subtype"] | null,"id": string,"kind": Database["public"]['Enums']["line_kind"],"label": string,"qty": number,"quote_id": string,"sort_order": number,"unit_amount": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discount_subtype"?: Database["public"]['Enums']["discount_subtype"] | null,"id"?: string,"kind": Database["public"]['Enums']["line_kind"],"label": string,"qty"?: number,"quote_id": string,"sort_order"?: number,"unit_amount": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discount_subtype"?: Database["public"]['Enums']["discount_subtype"] | null,"id"?: string,"kind"?: Database["public"]['Enums']["line_kind"],"label"?: string,"qty"?: number,"quote_id"?: string,"sort_order"?: number,"unit_amount"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_lines_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "advance_pct": number,"booking_id": string | null,"check_in": string,"check_out": string,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"deposit_amount": number,"guest_count": number | null,"guest_id": string | null,"id": string,"import_key": string | null,"inquiry_id": string | null,"issue_date": string,"notes": string | null,"number": string,"pdf_path": string | null,"prepared_for": string,"scope": Database["public"]['Enums']["stay_scope"],"share_token_hash": string | null,"status": Database["public"]['Enums']["quote_status"],"updated_at": string,"updated_by": string | null,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "advance_pct"?: number,"booking_id"?: string | null,"check_in": string,"check_out": string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"deposit_amount"?: number,"guest_count"?: number | null,"guest_id"?: string | null,"id"?: string,"import_key"?: string | null,"inquiry_id"?: string | null,"issue_date"?: string,"notes"?: string | null,"number": string,"pdf_path"?: string | null,"prepared_for": string,"scope"?: Database["public"]['Enums']["stay_scope"],"share_token_hash"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"updated_at"?: string,"updated_by"?: string | null,"valid_until"?: string | null
                  }
                  Update: {
                    "advance_pct"?: number,"booking_id"?: string | null,"check_in"?: string,"check_out"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"deposit_amount"?: number,"guest_count"?: number | null,"guest_id"?: string | null,"id"?: string,"import_key"?: string | null,"inquiry_id"?: string | null,"issue_date"?: string,"notes"?: string | null,"number"?: string,"pdf_path"?: string | null,"prepared_for"?: string,"scope"?: Database["public"]['Enums']["stay_scope"],"share_token_hash"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"updated_at"?: string,"updated_by"?: string | null,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "quotes_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "quotes_guest_id_fkey"
      columns: ["guest_id"]
isOneToOne: false
      referencedRelation: "guests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "inquiries"
      referencedColumns: ["id"]
    }
                  ]
                },"recurring_expenses": {
                  Row: {
                    "active": boolean,"amount": number | null,"cadence": string,"category": string,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"day_of_month": number,"default_paid_by_partner_id": string | null,"deleted_at": string | null,"end_month": string | null,"id": string,"item": string,"notes": string | null,"start_month": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount"?: number | null,"cadence"?: string,"category": string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"day_of_month"?: number,"default_paid_by_partner_id"?: string | null,"deleted_at"?: string | null,"end_month"?: string | null,"id"?: string,"item": string,"notes"?: string | null,"start_month"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"amount"?: number | null,"cadence"?: string,"category"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"day_of_month"?: number,"default_paid_by_partner_id"?: string | null,"deleted_at"?: string | null,"end_month"?: string | null,"id"?: string,"item"?: string,"notes"?: string | null,"start_month"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_expenses_default_paid_by_partner_id_fkey"
      columns: ["default_paid_by_partner_id"]
isOneToOne: false
      referencedRelation: "partner_capital"
      referencedColumns: ["partner_id"]
    },{
      foreignKeyName: "recurring_expenses_default_paid_by_partner_id_fkey"
      columns: ["default_paid_by_partner_id"]
isOneToOne: false
      referencedRelation: "partners"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "address": string,"advance_pct": number,"airbnb_payout_lag_days": number,"balance_pct": number,"base_currency": Database["public"]['Enums']["currency_code"],"brand": string,"check_in_time": string,"check_out_time": string,"created_at": string,"created_by": string | null,"default_usd_pkr": number,"deleted_at": string | null,"deposit_pct": number,"go_live_date": string,"id": string,"lease_start": string,"monthly_rent": number,"overdue_threshold_days": number,"property_name": string,"rent_due_day": number,"timezone": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string,"advance_pct"?: number,"airbnb_payout_lag_days"?: number,"balance_pct"?: number,"base_currency"?: Database["public"]['Enums']["currency_code"],"brand"?: string,"check_in_time"?: string,"check_out_time"?: string,"created_at"?: string,"created_by"?: string | null,"default_usd_pkr"?: number,"deleted_at"?: string | null,"deposit_pct"?: number,"go_live_date"?: string,"id"?: string,"lease_start"?: string,"monthly_rent"?: number,"overdue_threshold_days"?: number,"property_name"?: string,"rent_due_day"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "address"?: string,"advance_pct"?: number,"airbnb_payout_lag_days"?: number,"balance_pct"?: number,"base_currency"?: Database["public"]['Enums']["currency_code"],"brand"?: string,"check_in_time"?: string,"check_out_time"?: string,"created_at"?: string,"created_by"?: string | null,"default_usd_pkr"?: number,"deleted_at"?: string | null,"deposit_pct"?: number,"go_live_date"?: string,"id"?: string,"lease_start"?: string,"monthly_rent"?: number,"overdue_threshold_days"?: number,"property_name"?: string,"rent_due_day"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"sync_runs": {
                  Row: {
                    "counts": NonNullable<Json>,"created_at": string,"created_by": string | null,"deleted_at": string | null,"error": string | null,"finished_at": string | null,"id": string,"job_name": string,"result": string | null,"started_at": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "counts"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"job_name": string,"result"?: string | null,"started_at"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "counts"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"job_name"?: string,"result"?: string | null,"started_at"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"tasks": {
                  Row: {
                    "assignee_id": string | null,"auto_key": string | null,"booking_id": string | null,"category": Database["public"]['Enums']["task_category"],"created_at": string,"created_by": string | null,"deleted_at": string | null,"due_date": string | null,"id": string,"import_key": string | null,"notes": string | null,"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"auto_key"?: string | null,"booking_id"?: string | null,"category"?: Database["public"]['Enums']["task_category"],"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"import_key"?: string | null,"notes"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "assignee_id"?: string | null,"auto_key"?: string | null,"booking_id"?: string | null,"category"?: Database["public"]['Enums']["task_category"],"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"import_key"?: string | null,"notes"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "tasks_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    }
                  ]
                },"vendor_quotes": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"description": string | null,"id": string,"import_key": string | null,"notes": string | null,"quoted_amount": number,"updated_at": string,"updated_by": string | null,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"import_key"?: string | null,"notes"?: string | null,"quoted_amount": number,"updated_at"?: string,"updated_by"?: string | null,"vendor": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"import_key"?: string | null,"notes"?: string | null,"quoted_amount"?: number,"updated_at"?: string,"updated_by"?: string | null,"vendor"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "alerts": {
                  Row: {
                    "alert_date": string | null,"booking_id": string | null,"detail": string | null,"kind": string | null,"link": string | null,"severity": string | null,"title": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"booking_financials": {
                  Row: {
                    "accommodation": number | null,"booked_at": string | null,"booking_id": string,"booking_type": Database["public"]['Enums']["booking_type"],"cancellation_reason": string | null,"cancelled_on": string | null,"channel_code": string,"channel_color": string,"channel_id": string,"channel_name": string,"check_in": string,"check_out": string,"currency": Database["public"]['Enums']["currency_code"] | null,"discounts": number | null,"fees": number | null,"gross": number | null,"guest_count": number | null,"guest_id": string | null,"guest_name": string | null,"guest_phone": string | null,"mixed_currency": boolean | null,"needs_details": boolean,"net": number | null,"net_pkr": number | null,"nights": number | null,"pkr_is_estimate": boolean | null,"pkr_rate": number | null,"platform_fee": number | null,"platform_fee_is_actual": boolean | null,"possibly_cancelled_at": string | null,"ref": string | null,"revenue_state": string | null,"source": Database["public"]['Enums']["record_source"],"status": Database["public"]['Enums']["booking_status"],"tax": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "bookings_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_guest_id_fkey"
      columns: ["guest_id"]
isOneToOne: false
      referencedRelation: "guests"
      referencedColumns: ["id"]
    }
                  ]
                },"calendar_conflicts": {
                  Row: {
                    "a_id": string | null,"a_type": string | null,"b_id": string | null,"b_type": string | null,"end_date": string | null,"start_date": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"monthly_pnl_accrual": {
                  Row: {
                    "booked_revenue_pkr": number | null,"earned_revenue_pkr": number | null,"has_estimates": boolean | null,"month": string | null,"net_profit_pkr": number | null,"nights": number | null,"nights_earned": number | null,"operating_expenses_pkr": number | null,"other_revenue_pkr": number | null,"stay_revenue_pkr": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"monthly_pnl_cash": {
                  Row: {
                    "month": string | null,"net_profit_pkr": number | null,"paid_operating_pkr": number | null,"realized_revenue_pkr": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"nightly_allocation": {
                  Row: {
                    "accommodation": number | null,"booking_id": string,"booking_type": Database["public"]['Enums']["booking_type"],"channel_id": string,"currency": Database["public"]['Enums']["currency_code"] | null,"discounts": number | null,"fees": number | null,"month": string | null,"net": number | null,"net_pkr": number | null,"night": string | null,"pkr_is_estimate": boolean | null,"platform_fee": number | null,"revenue_state": string | null,"status": Database["public"]['Enums']["booking_status"]
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "bookings_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    }
                  ]
                },"occupancy_daily": {
                  Row: {
                    "blocked": boolean | null,"day": string | null,"occupied_nonstandard": boolean | null,"occupied_standard": boolean | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"partner_capital": {
                  Row: {
                    "agreed_share_pct": number,"capital_pct": number | null,"capital_recovered_pct": number | null,"capital_returned": number | null,"cash_contributed": number | null,"distributions": number | null,"email": string | null,"name": string,"partner_id": string,"profit_share": number | null,"realized_net_profit": number | null,"reimbursements_owed": number | null,"setup_paid_personally": number | null,"shortfall_to_equal": number | null,"sort_order": number,"total_invested": number | null,"undistributed": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"payment_facts": {
                  Row: {
                    "amount_due": number | null,"amount_received": number | null,"booking_id": string | null,"cash_sign": number | null,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"deleted_at": string | null,"due_date": string | null,"external_ref": string | null,"forwarded_date": string | null,"fx_rate": number | null,"held_by_partner": boolean | null,"id": string,"import_key": string | null,"is_estimate": boolean,"kind": Database["public"]['Enums']["payment_kind"],"method": Database["public"]['Enums']["payment_method"] | null,"notes": string | null,"pkr_received": number | null,"proof_path": string | null,"realized_date": string | null,"realized_pkr": number | null,"received_by_partner_id": string | null,"received_date": string | null,"revenue_sign": number | null,"status": Database["public"]['Enums']["payment_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "booking_financials"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "nightly_allocation"
      referencedColumns: ["booking_id"]
    },{
      foreignKeyName: "payments_received_by_partner_id_fkey"
      columns: ["received_by_partner_id"]
isOneToOne: false
      referencedRelation: "partner_capital"
      referencedColumns: ["partner_id"]
    },{
      foreignKeyName: "payments_received_by_partner_id_fkey"
      columns: ["received_by_partner_id"]
isOneToOne: false
      referencedRelation: "partners"
      referencedColumns: ["id"]
    }
                  ]
                },"project_account_ledger": {
                  Row: {
                    "amount": number | null,"balance": number | null,"description": string | null,"entry_date": string | null,"kind": string | null,"source_id": string | null,"source_table": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"staff_calendar": {
                  Row: {
                    "channel_name": string | null,"checkin_notes": string | null,"color": string | null,"end_date": string | null,"guest_count": number | null,"guest_name": string | null,"guest_phone": string | null,"id": string | null,"item_type": string | null,"nights": number | null,"start_date": string | null,"status": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"vendor_balances": {
                  Row: {
                    "currency": Database["public"]['Enums']["currency_code"],"description": string | null,"paid": number | null,"quoted_amount": number,"remaining": number | null,"vendor": string,"vendor_quote_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "app_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["app_role"]
                           },
"booking_holds_dates":
{ Args: { "s": Database["public"]['Enums']["booking_status"] }; Returns: boolean
                           },
"current_member":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"email": string,"id": string,"role": Database["public"]['Enums']["app_role"]
            }[]
                           },
"expense_pkr":
{ Args: { "p_amount": number,"p_currency": Database["public"]['Enums']["currency_code"] }; Returns: number
                           },
"find_conflicts":
{ Args: { "p_end": string,"p_exclude_block"?: string,"p_exclude_booking"?: string,"p_start": string }; Returns: {
              "end_date": string,"is_hard": boolean,"item_id": string,"item_type": string,"label": string,"start_date": string
            }[]
                           },
"format_pk_date":
{ Args: { "d": string }; Returns: string
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"is_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"next_doc_number":
{ Args: { "p_prefix": string,"p_year"?: number }; Returns: string
                           },
"occupancy_stats":
{ Args: { "p_end": string,"p_exclude_nonstandard"?: boolean,"p_start": string }; Returns: {
              "available": number,"occupied": number,"rate": number
            }[]
                           },
"overview_kpis":
{ Args: { "p_exclude_nonstandard"?: boolean,"p_month"?: string }; Returns: {
              "adr_has_estimates": boolean,"adr_this_pkr": number,"capital_recovered_pct": number,"deposits_held_pkr": number,"guest_balances_due_pkr": number,"month_start": string,"occ_next_available": number,"occ_next_occupied": number,"occ_next_rate": number,"occ_this_available": number,"occ_this_completed": number,"occ_this_occupied": number,"occ_this_rate": number,"on_the_books_has_estimates": boolean,"on_the_books_pkr": number,"opex_mtd_pkr": number,"pending_payouts_count": number,"pending_payouts_pkr_est": number,"project_balance_pkr": number,"realized_mtd_pkr": number,"realized_net_profit_pkr": number,"realized_to_date_pkr": number,"total_invested_pkr": number
            }[]
                           },
"pk_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"save_booking":
{ Args: { "p_booking": Json,"p_guest"?: Json,"p_lines": Json }; Returns: string
                           },
"track_table":
{ Args: { "p_table": unknown }; Returns: undefined
                           }
          }
          Enums: {
            "app_role": "owner"|"partner"|"staff","block_reason": "owner_use"|"maintenance"|"channel_hold","booking_status": "tentative"|"confirmed"|"in_house"|"completed"|"cancelled"|"no_show"|"fraud","booking_type": "standard"|"partner_friends"|"promotional","capital_type": "contribution"|"distribution"|"capital_return","currency_code": "PKR"|"USD","discount_subtype": "friends_family"|"length_of_stay"|"new_listing_promo"|"early_bird"|"special_deal"|"custom","expense_kind": "setup"|"operating","expense_status": "due"|"paid","feed_kind": "direct"|"all","inquiry_status": "new"|"quoted"|"awaiting_advance"|"won"|"lost"|"expired","line_kind": "accommodation"|"cleaning_fee"|"extra_guest"|"extra_mattress"|"airport_pickup"|"late_checkout"|"other_fee"|"discount"|"platform_fee"|"tax","payment_kind": "advance"|"balance"|"full"|"airbnb_payout"|"booking_com_payout"|"deposit_in"|"deposit_refund"|"deposit_withheld"|"guest_refund"|"cancellation_payout"|"extra_charge","payment_method": "airbnb_payout"|"bank_transfer"|"cash"|"jazzcash"|"easypaisa"|"other","payment_status": "scheduled"|"due"|"received"|"overdue"|"waived","quote_status": "draft"|"sent"|"accepted"|"declined"|"expired","record_source": "manual"|"ical"|"csv"|"import","stay_scope": "full_house"|"single_room","task_category": "turnover"|"guest_request"|"maintenance"|"admin"|"purchase","task_status": "todo"|"doing"|"done"|"blocked"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["owner", "partner", "staff"],"block_reason": ["owner_use", "maintenance", "channel_hold"],"booking_status": ["tentative", "confirmed", "in_house", "completed", "cancelled", "no_show", "fraud"],"booking_type": ["standard", "partner_friends", "promotional"],"capital_type": ["contribution", "distribution", "capital_return"],"currency_code": ["PKR", "USD"],"discount_subtype": ["friends_family", "length_of_stay", "new_listing_promo", "early_bird", "special_deal", "custom"],"expense_kind": ["setup", "operating"],"expense_status": ["due", "paid"],"feed_kind": ["direct", "all"],"inquiry_status": ["new", "quoted", "awaiting_advance", "won", "lost", "expired"],"line_kind": ["accommodation", "cleaning_fee", "extra_guest", "extra_mattress", "airport_pickup", "late_checkout", "other_fee", "discount", "platform_fee", "tax"],"payment_kind": ["advance", "balance", "full", "airbnb_payout", "booking_com_payout", "deposit_in", "deposit_refund", "deposit_withheld", "guest_refund", "cancellation_payout", "extra_charge"],"payment_method": ["airbnb_payout", "bank_transfer", "cash", "jazzcash", "easypaisa", "other"],"payment_status": ["scheduled", "due", "received", "overdue", "waived"],"quote_status": ["draft", "sent", "accepted", "declined", "expired"],"record_source": ["manual", "ical", "csv", "import"],"stay_scope": ["full_house", "single_room"],"task_category": ["turnover", "guest_request", "maintenance", "admin", "purchase"],"task_status": ["todo", "doing", "done", "blocked"]
          }
        }
} as const
